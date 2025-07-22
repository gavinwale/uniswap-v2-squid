import { DataHandlerContext, BlockData } from '@subsquid/evm-processor'
import { EntityManager } from '../utils/entityManager'
import { BlockMap } from '../utils/blockMap'
import { events as pairEvents } from '../abi/uniswapV2Pair'
import { UniswapFactory, Token, Pair, Bundle, Transaction, Mint, Burn, Swap } from '../model'
import { FACTORY_ADDRESS, TOKEN_DECIMALS } from '../utils/constants'
import { WHITELIST_TOKENS, STABLE_COINS, WETH_ADDRESS, getTrackedVolumeUSD, getTrackedLiquidityUSD } from '../utils/pricing'
import { convertTokenToDecimal, addressToBytes, ZERO_BD, ONE_BD } from '../utils/tools'

interface EventData {
  type: 'sync' | 'mint' | 'burn' | 'swap'
  pairId: string
  txHash: string
  logIndex: number
  data: any
}

type ContextWithEntityManager = DataHandlerContext<any> & {
  entities: EntityManager
}

export async function processPairs(
  ctx: ContextWithEntityManager,
  blocks: BlockData[]
): Promise<void> {
  const eventsData = await processItems(ctx, blocks)

  if (eventsData.size === 0) return

  await prefetch(ctx, eventsData)

  let bundle = await ctx.entities.get(Bundle, '1')
  if (!bundle) {
    bundle = createBundle('1')
    ctx.entities.add(bundle)
  }

  let factory = await ctx.entities.get(UniswapFactory, FACTORY_ADDRESS)
  if (!factory) {
    factory = createFactory(FACTORY_ADDRESS)
    ctx.entities.add(factory)
  }

  let processedEvents = 0
  let skippedEvents = 0
  let totalEvents = 0

  // Count total events for progress
  for (const [, blockEventsData] of eventsData) {
    totalEvents += blockEventsData.length
  }

  // Process events in order
  for (const [block, blockEventsData] of eventsData) {
    for (const eventData of blockEventsData) {
      const pair = ctx.entities.get(Pair, eventData.pairId, false)
      if (!pair) {
        skippedEvents++
        continue
      }

      const token0 = ctx.entities.get(Token, pair.token0.id, false)
      const token1 = ctx.entities.get(Token, pair.token1.id, false)

      if (!token0 || !token1) {
        skippedEvents++
        continue
      }

      let transaction = ctx.entities.get(Transaction, eventData.txHash, false)
      if (!transaction) {
        transaction = createTransaction(eventData.txHash, block)
        ctx.entities.add(transaction)
      }

      switch (eventData.type) {
        case 'sync':
          handleSync(eventData, pair, token0, token1, bundle)
          break
        case 'mint':
          handleMint(eventData, block, transaction, pair, token0, token1, bundle, factory, ctx)
          break
        case 'burn':
          handleBurn(eventData, block, transaction, pair, token0, token1, bundle, factory, ctx)
          break
        case 'swap':
          handleSwap(eventData, block, transaction, pair, token0, token1, bundle, factory, ctx)
          break
      }
      processedEvents++
    }
  }

  // Final price update
  await updatePrices(ctx, bundle)
  updateFactoryLiquidity(ctx, factory)

  // Log processing summary
  if (processedEvents > 0 || skippedEvents > 0) {
    ctx.log.info(`Processed ${processedEvents} events${skippedEvents > 0 ? `, skipped ${skippedEvents} from unknown pairs` : ''}`)
  }
}

async function prefetch(
  ctx: ContextWithEntityManager,
  eventsData: BlockMap<EventData>
) {
  const pairIds = new Set<string>()
  const txHashes = new Set<string>()

  for (const [, blockEventsData] of eventsData) {
    for (const data of blockEventsData) {
      pairIds.add(data.pairId)
      txHashes.add(data.txHash)
    }
  }

  // Load pairs WITH their token relationships
  const pairs = await ctx.store.find(Pair, {
    where: { id: Array.from(pairIds) as any },
    relations: { token0: true, token1: true }
  })

  for (const pair of pairs) {
    ctx.entities.add(pair)
    ctx.entities.add(pair.token0)
    ctx.entities.add(pair.token1)
  }

  ctx.entities.defer(Transaction, ...txHashes)
  await ctx.entities.load(Transaction)
}

async function processItems(
  ctx: ContextWithEntityManager,
  blocks: BlockData[]
) {
  let eventsData = new BlockMap<EventData>()

  for (let block of blocks) {
    for (let log of block.logs) {
      const pairId = log.address.toLowerCase()

      try {
        if (log.topics[0] === pairEvents.Sync.topic && log.topics.length === 1) {
          const event = pairEvents.Sync.decode(log)
          eventsData.push(block.header, {
            type: 'sync',
            pairId,
            txHash: log.transaction?.hash || log.id,
            logIndex: log.logIndex || 0,
            data: event
          })
        } else if (log.topics[0] === pairEvents.Mint.topic && log.topics.length === 2) {
          const event = pairEvents.Mint.decode(log)
          eventsData.push(block.header, {
            type: 'mint',
            pairId,
            txHash: log.transaction?.hash || log.id,
            logIndex: log.logIndex || 0,
            data: event
          })
        } else if (log.topics[0] === pairEvents.Burn.topic && log.topics.length === 3) {
          const event = pairEvents.Burn.decode(log)
          eventsData.push(block.header, {
            type: 'burn',
            pairId,
            txHash: log.transaction?.hash || log.id,
            logIndex: log.logIndex || 0,
            data: event
          })
        } else if (log.topics[0] === pairEvents.Swap.topic && log.topics.length === 3) {
          const event = pairEvents.Swap.decode(log)
          eventsData.push(block.header, {
            type: 'swap',
            pairId,
            txHash: log.transaction?.hash || log.id,
            logIndex: log.logIndex || 0,
            data: event
          })
        }
      } catch (error) {
        // Skip logs that can't be decoded (might be from different contract versions)
        ctx.log.warn(`Failed to decode log at ${log.address}:${log.logIndex}: ${error}`)
        continue
      }
    }
  }

  return eventsData
}

function handleSync(eventData: EventData, pair: Pair, token0: Token, token1: Token, bundle: Bundle) {
  const { reserve0, reserve1 } = eventData.data

  // Update reserves
  pair.reserve0 = convertTokenToDecimal(reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(reserve1, token1.decimals)

  // Update prices
  pair.token0Price = pair.reserve0 > 0 ? pair.reserve1 / pair.reserve0 : 0
  pair.token1Price = pair.reserve1 > 0 ? pair.reserve0 / pair.reserve1 : 0

  // Update derived liquidity
  pair.reserveETH = pair.reserve0 * token0.derivedETH + pair.reserve1 * token1.derivedETH
  pair.reserveUSD = pair.reserveETH * bundle.ethPrice

  // Calculate tracked liquidity
  const trackedLiquidityUSD = getTrackedLiquidityUSD(
    pair.reserve0, token0.id,
    pair.reserve1, token1.id,
    { ethPriceUSD: bundle.ethPrice }, token0.derivedETH, token1.derivedETH
  )
  pair.trackedReserveETH = bundle.ethPrice > 0 ? trackedLiquidityUSD / bundle.ethPrice : 0
}

function handleMint(
  eventData: EventData, 
  block: any, 
  transaction: Transaction, 
  pair: Pair, 
  token0: Token, 
  token1: Token, 
  bundle: Bundle, 
  factory: UniswapFactory,
  ctx: ContextWithEntityManager
) {
  const { sender, amount0, amount1 } = eventData.data

  const token0Amount = convertTokenToDecimal(amount0, token0.decimals)
  const token1Amount = convertTokenToDecimal(amount1, token1.decimals)

  const amountUSD = token0Amount * token0.derivedETH * bundle.ethPrice + 
                   token1Amount * token1.derivedETH * bundle.ethPrice

  const mint = new Mint({
    id: `${eventData.txHash}-${eventData.logIndex}`,
    transaction,
    timestamp: BigInt(block.timestamp),
    pair,
    to: addressToBytes(sender.toLowerCase()),
    liquidity: 0,
    sender: addressToBytes(sender.toLowerCase()),
    amount0: token0Amount,
    amount1: token1Amount,
    logIndex: BigInt(eventData.logIndex),
    amountUSD,
    feeTo: null,
    feeLiquidity: null
  })

  ctx.entities.add(mint)

  // Update counters
  pair.txCount += 1n
  token0.txCount += 1n
  token1.txCount += 1n
  factory.txCount += 1n
}

function handleBurn(
  eventData: EventData, 
  block: any, 
  transaction: Transaction, 
  pair: Pair, 
  token0: Token, 
  token1: Token, 
  bundle: Bundle, 
  factory: UniswapFactory,
  ctx: ContextWithEntityManager
) {
  const { sender, amount0, amount1, to } = eventData.data

  const token0Amount = convertTokenToDecimal(amount0, token0.decimals)
  const token1Amount = convertTokenToDecimal(amount1, token1.decimals)

  const amountUSD = token0Amount * token0.derivedETH * bundle.ethPrice + 
                   token1Amount * token1.derivedETH * bundle.ethPrice

  const burn = new Burn({
    id: `${eventData.txHash}-${eventData.logIndex}`,
    transaction,
    timestamp: BigInt(block.timestamp),
    pair,
    liquidity: 0,
    sender: addressToBytes(sender.toLowerCase()),
    amount0: token0Amount,
    amount1: token1Amount,
    to: addressToBytes(to.toLowerCase()),
    logIndex: BigInt(eventData.logIndex),
    amountUSD,
    needsComplete: false,
    feeTo: null,
    feeLiquidity: null
  })

  ctx.entities.add(burn)

  // Update counters
  pair.txCount += 1n
  token0.txCount += 1n
  token1.txCount += 1n
  factory.txCount += 1n
}

function handleSwap(
  eventData: EventData, 
  block: any, 
  transaction: Transaction, 
  pair: Pair, 
  token0: Token, 
  token1: Token, 
  bundle: Bundle, 
  factory: UniswapFactory,
  ctx: ContextWithEntityManager
) {
  const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = eventData.data

  const amount0InDecimal = convertTokenToDecimal(amount0In, token0.decimals)
  const amount1InDecimal = convertTokenToDecimal(amount1In, token1.decimals)
  const amount0OutDecimal = convertTokenToDecimal(amount0Out, token0.decimals)
  const amount1OutDecimal = convertTokenToDecimal(amount1Out, token1.decimals)

  // Calculate total amounts (volume)
  const amount0Total = amount0InDecimal + amount0OutDecimal
  const amount1Total = amount1InDecimal + amount1OutDecimal

  // Calculate USD amounts
  const amount0USD = amount0Total * token0.derivedETH * bundle.ethPrice
  const amount1USD = amount1Total * token1.derivedETH * bundle.ethPrice
  const derivedAmountUSD = (amount0USD + amount1USD) / 2

  const trackedAmountUSD = getTrackedVolumeUSD(token0.id, amount0USD, token1.id, amount1USD)
  const finalAmountUSD = trackedAmountUSD > 0 ? trackedAmountUSD : derivedAmountUSD

  const swap = new Swap({
    id: `${eventData.txHash}-${eventData.logIndex}`,
    transaction,
    timestamp: BigInt(block.timestamp),
    pair,
    sender: addressToBytes(sender.toLowerCase()),
    from: addressToBytes(sender.toLowerCase()),
    amount0In: amount0InDecimal,
    amount1In: amount1InDecimal,
    amount0Out: amount0OutDecimal,
    amount1Out: amount1OutDecimal,
    to: addressToBytes(to.toLowerCase()),
    logIndex: BigInt(eventData.logIndex),
    amountUSD: finalAmountUSD
  })

  ctx.entities.add(swap)

  // Update volumes
  pair.volumeToken0 += amount0Total
  pair.volumeToken1 += amount1Total
  pair.volumeUSD += finalAmountUSD
  pair.untrackedVolumeUSD += derivedAmountUSD
  pair.txCount += 1n

  token0.tradeVolume += amount0Total
  token0.tradeVolumeUSD += finalAmountUSD / 2
  token0.untrackedVolumeUSD += derivedAmountUSD / 2
  token0.txCount += 1n

  token1.tradeVolume += amount1Total
  token1.tradeVolumeUSD += finalAmountUSD / 2
  token1.untrackedVolumeUSD += derivedAmountUSD / 2
  token1.txCount += 1n

  // Update factory
  const trackedAmountETH = bundle.ethPrice > 0 ? finalAmountUSD / bundle.ethPrice : 0
  factory.totalVolumeUSD += finalAmountUSD
  factory.totalVolumeETH += trackedAmountETH
  factory.untrackedVolumeUSD += derivedAmountUSD
  factory.txCount += 1n
}

async function updatePrices(ctx: ContextWithEntityManager, bundle: Bundle) {
  // Update ETH price using database queries
  const oldEthPrice = bundle.ethPrice
  bundle.ethPrice = await getEthPriceInUSD(ctx)

  // Log significant price changes only
  if (Math.abs(bundle.ethPrice - oldEthPrice) > 10) {
    ctx.log.info(`ETH price updated: $${oldEthPrice.toFixed(2)} → $${bundle.ethPrice.toFixed(2)}`)
  }

  // Update token prices using database queries
  for (const token of ctx.entities.values(Token)) {
    token.derivedETH = await findEthPerToken(token, ctx)
  }
}

function updateFactoryLiquidity(ctx: ContextWithEntityManager, factory: UniswapFactory) {
  let totalLiquidityETH = 0
  let totalLiquidityUSD = 0
  
  for (const pair of ctx.entities.values(Pair)) {
    totalLiquidityETH += pair.reserveETH
    totalLiquidityUSD += pair.reserveUSD
  }
  
  factory.totalLiquidityETH = totalLiquidityETH
  factory.totalLiquidityUSD = totalLiquidityUSD
}

async function getEthPriceInUSD(ctx: ContextWithEntityManager): Promise<number> {
  const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'
  const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'

  let bestPrice = 0
  let bestLiquidity = 0

  // Query database for ALL stablecoin pairs (not just current batch)
  const stablecoinPairs = await ctx.store.find(Pair, {
    where: [
      { token0: { id: DAI_ADDRESS }, token1: { id: WETH_ADDRESS } },
      { token0: { id: WETH_ADDRESS }, token1: { id: DAI_ADDRESS } },
      { token0: { id: USDC_ADDRESS }, token1: { id: WETH_ADDRESS } },
      { token0: { id: WETH_ADDRESS }, token1: { id: USDC_ADDRESS } },
      { token0: { id: USDT_ADDRESS }, token1: { id: WETH_ADDRESS } },
      { token0: { id: WETH_ADDRESS }, token1: { id: USDT_ADDRESS } },
    ],
    relations: { token0: true, token1: true }
  })

  for (const pair of stablecoinPairs) {
    if (pair.reserve0 > 0 && pair.reserve1 > 0) {
      let ethPrice = 0
      let liquidityUSD = 0

      // DAI/WETH pair
      if (pair.token0.id === DAI_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        ethPrice = pair.reserve0 / pair.reserve1 // DAI per WETH
        liquidityUSD = pair.reserve0 // DAI liquidity
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === DAI_ADDRESS) {
        ethPrice = pair.reserve1 / pair.reserve0 // DAI per WETH
        liquidityUSD = pair.reserve1 // DAI liquidity
      }
      // USDC/WETH pair
      else if (pair.token0.id === USDC_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        ethPrice = pair.reserve0 / pair.reserve1 // USDC per WETH
        liquidityUSD = pair.reserve0 // USDC liquidity
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === USDC_ADDRESS) {
        ethPrice = pair.reserve1 / pair.reserve0 // USDC per WETH
        liquidityUSD = pair.reserve1 // USDC liquidity
      }
      // USDT/WETH pair
      else if (pair.token0.id === USDT_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        ethPrice = pair.reserve0 / pair.reserve1 // USDT per WETH
        liquidityUSD = pair.reserve0 // USDT liquidity
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === USDT_ADDRESS) {
        ethPrice = pair.reserve1 / pair.reserve0 // USDT per WETH
        liquidityUSD = pair.reserve1 // USDT liquidity
      }

      if (ethPrice > 0 && liquidityUSD > bestLiquidity) {
        bestPrice = ethPrice
        bestLiquidity = liquidityUSD
      }
    }
  }

  return bestPrice > 0 ? bestPrice : 300 // Default fallback
}

async function findEthPerToken(token: Token, ctx: ContextWithEntityManager): Promise<number> {
  if (token.id === WETH_ADDRESS) {
    return 1
  }

  // For stablecoins, use inverse of ETH price
  if (STABLE_COINS.includes(token.id)) {
    const ethPrice = await getEthPriceInUSD(ctx)
    return ethPrice > 0 ? 1 / ethPrice : 0
  }

  // Find best WETH pair using database queries
  const wethPairs = await ctx.store.find(Pair, {
    where: [
      { token0: { id: token.id }, token1: { id: WETH_ADDRESS } },
      { token0: { id: WETH_ADDRESS }, token1: { id: token.id } }
    ],
    relations: { token0: true, token1: true }
  })

  let bestLiquidity = 0
  let bestPrice = 0

  for (const pair of wethPairs) {
    if (pair.reserve0 > 0 && pair.reserve1 > 0) {
      if (pair.token0.id === token.id && pair.token1.id === WETH_ADDRESS) {
        const liquidity = pair.reserveETH
        if (liquidity > bestLiquidity) {
          bestLiquidity = liquidity
          bestPrice = pair.reserve1 / pair.reserve0 // WETH per token
        }
      } else if (pair.token1.id === token.id && pair.token0.id === WETH_ADDRESS) {
        const liquidity = pair.reserveETH
        if (liquidity > bestLiquidity) {
          bestLiquidity = liquidity
          bestPrice = pair.reserve0 / pair.reserve1 // WETH per token
        }
      }
    }
  }

  return bestPrice
}

function createFactory(id: string) {
  const factory = new UniswapFactory({ id })
  factory.pairCount = 0
  factory.totalVolumeETH = 0
  factory.totalVolumeUSD = 0
  factory.untrackedVolumeUSD = 0
  factory.totalLiquidityETH = 0
  factory.totalLiquidityUSD = 0
  factory.txCount = 0n
  return factory
}

function createBundle(id: string) {
  const bundle = new Bundle({ id })
  bundle.ethPrice = 300 // Default ETH price
  return bundle
}

function createTransaction(id: string, block: any) {
  const transaction = new Transaction({ id })
  transaction.blockNumber = BigInt(block.height)
  transaction.timestamp = BigInt(block.timestamp)
  return transaction
}
