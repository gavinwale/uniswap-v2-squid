import { DataHandlerContext } from '@subsquid/evm-processor'
import { Store } from '@subsquid/typeorm-store'
import { In } from 'typeorm'
import { events as factoryEvents } from '../abi/uniswapV2Factory'
import { events as pairEvents } from '../abi/uniswapV2Pair'
import { UniswapFactory, Token, Pair, Bundle, Transaction, Mint, Burn, Swap } from '../model'
import { FACTORY_ADDRESS, WETH_ADDRESS, STABLE_COINS } from '../utils/constants'
import { convertTokenToDecimal } from '../utils/tools'
import { getTrackedVolumeUSD, getTrackedLiquidityUSD } from '../utils/pricing'

interface ProcessedEvent {
  type: 'pairCreated' | 'sync' | 'mint' | 'burn' | 'swap'
  blockNumber: number
  timestamp: number
  txHash: string
  logIndex: number
  data: any
  pairAddress?: string
}

export async function processBlocks(ctx: DataHandlerContext<Store>) {
  const events = extractEvents(ctx)
  
  const { factory, bundle } = await loadCoreEntities(ctx.store)
  
  const { tokens, pairs, transactions } = await processEvents(ctx, events, factory, bundle)
  
  await updatePricing(ctx.store, bundle, pairs)
  
  await calculateUSDValues(pairs, bundle, transactions)
  
  updateFactoryStats(factory, pairs, transactions)
  
  await saveEntities(ctx.store, { factory, bundle, tokens, pairs, transactions })
  
  logProgress(ctx, factory, bundle, transactions)
}

function extractEvents(ctx: DataHandlerContext<Store>): ProcessedEvent[] {
  const events: ProcessedEvent[] = []
  
  for (const block of ctx.blocks) {
    const timestamp = block.header.timestamp / 1000
    
    for (const log of block.logs) {
      try {
        if (log.address === FACTORY_ADDRESS && log.topics[0] === factoryEvents.PairCreated.topic) {
          const event = factoryEvents.PairCreated.decode(log)
          events.push({
            type: 'pairCreated',
            blockNumber: block.header.height,
            timestamp,
            txHash: log.transaction?.hash || log.id,
            logIndex: log.logIndex || 0,
            data: event
          })
        }
        
        else if (log.topics.length >= 1) {
          const topic = log.topics[0]
          
          if (topic === pairEvents.Sync.topic) {
            const event = pairEvents.Sync.decode(log)
            events.push({
              type: 'sync',
              blockNumber: block.header.height,
              timestamp,
              txHash: log.transaction?.hash || log.id,
              logIndex: log.logIndex || 0,
              pairAddress: log.address,
              data: event
            })
          }
          else if (topic === pairEvents.Mint.topic) {
            const event = pairEvents.Mint.decode(log)
            events.push({
              type: 'mint',
              blockNumber: block.header.height,
              timestamp,
              txHash: log.transaction?.hash || log.id,
              logIndex: log.logIndex || 0,
              pairAddress: log.address,
              data: event
            })
          }
          else if (topic === pairEvents.Burn.topic) {
            const event = pairEvents.Burn.decode(log)
            events.push({
              type: 'burn',
              blockNumber: block.header.height,
              timestamp,
              txHash: log.transaction?.hash || log.id,
              logIndex: log.logIndex || 0,
              pairAddress: log.address,
              data: event
            })
          }
          else if (topic === pairEvents.Swap.topic) {
            const event = pairEvents.Swap.decode(log)
            events.push({
              type: 'swap',
              blockNumber: block.header.height,
              timestamp,
              txHash: log.transaction?.hash || log.id,
              logIndex: log.logIndex || 0,
              pairAddress: log.address,
              data: event
            })
          }
        }
      } catch (error) {
        continue
      }
    }
  }
  
  return events.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
    return a.logIndex - b.logIndex
  })
}

async function loadCoreEntities(store: Store): Promise<{ factory: UniswapFactory, bundle: Bundle }> {
  let factory = await store.get(UniswapFactory, FACTORY_ADDRESS)
  if (!factory) {
    factory = new UniswapFactory({
      id: FACTORY_ADDRESS,
      pairCount: 0,
      totalVolumeUSD: 0,
      totalVolumeETH: 0,
      untrackedVolumeUSD: 0,
      totalLiquidityUSD: 0,
      totalLiquidityETH: 0,
      txCount: 0n
    })
  }
  
  let bundle = await store.get(Bundle, '1')
  if (!bundle) {
    bundle = new Bundle({
      id: '1',
      ethPrice: 0
    })
  }
  
  return { factory, bundle }
}

async function processEvents(
  ctx: DataHandlerContext<Store>, 
  events: ProcessedEvent[], 
  factory: UniswapFactory, 
  bundle: Bundle
): Promise<{ tokens: Map<string, Token>, pairs: Map<string, Pair>, transactions: Map<string, Transaction> }> {
  const tokens = new Map<string, Token>()
  const pairs = new Map<string, Pair>()
  const transactions = new Map<string, Transaction>()
  
  const existingTokenIds = new Set<string>()
  const existingPairIds = new Set<string>()
  const existingTxIds = new Set<string>()
  
  for (const event of events) {
    if (event.type === 'pairCreated') {
      existingTokenIds.add(event.data.token0.toLowerCase())
      existingTokenIds.add(event.data.token1.toLowerCase())
      existingPairIds.add(event.data.pair.toLowerCase())
    } else if (event.pairAddress) {
      existingPairIds.add(event.pairAddress.toLowerCase())
    }
    existingTxIds.add(event.txHash)
  }
  
  if (existingTokenIds.size > 0) {
    const existingTokens = await ctx.store.find(Token, { where: { id: In([...existingTokenIds]) } })
    for (const token of existingTokens) {
      tokens.set(token.id, token)
    }
  }
  
  if (existingPairIds.size > 0) {
    const existingPairs = await ctx.store.find(Pair, { 
      where: { id: In([...existingPairIds]) },
      relations: { token0: true, token1: true }
    })
    for (const pair of existingPairs) {
      pairs.set(pair.id, pair)
    }
  }
  
  if (existingTxIds.size > 0) {
    const existingTxs = await ctx.store.find(Transaction, { where: { id: In([...existingTxIds]) } })
    for (const tx of existingTxs) {
      transactions.set(tx.id, tx)
    }
  }
  
  for (const event of events) {
    if (!transactions.has(event.txHash)) {
      transactions.set(event.txHash, new Transaction({
        id: event.txHash,
        blockNumber: BigInt(event.blockNumber),
        timestamp: BigInt(event.timestamp)
      }))
    }
    
    if (event.type === 'pairCreated') {
      await handlePairCreated(event, factory, tokens, pairs)
    } else if (event.pairAddress) {
      const pair = pairs.get(event.pairAddress.toLowerCase())
      if (pair) {
        await handlePairEvent(event, pair, tokens, transactions, bundle)
      }
    }
  }
  
  return { tokens, pairs, transactions }
}

async function handlePairCreated(
  event: ProcessedEvent, 
  factory: UniswapFactory, 
  tokens: Map<string, Token>, 
  pairs: Map<string, Pair>
) {
  const { token0: token0Address, token1: token1Address, pair: pairAddress } = event.data
  
  const token0Id = token0Address.toLowerCase()
  const token1Id = token1Address.toLowerCase()
  
  if (!tokens.has(token0Id)) {
    tokens.set(token0Id, createToken(token0Id))
  }
  
  if (!tokens.has(token1Id)) {
    tokens.set(token1Id, createToken(token1Id))
  }
  
  const pairId = pairAddress.toLowerCase()
  const pair = new Pair({
    id: pairId,
    token0: tokens.get(token0Id)!,
    token1: tokens.get(token1Id)!,
    reserve0: 0,
    reserve1: 0,
    totalSupply: 0,
    reserveETH: 0,
    reserveUSD: 0,
    trackedReserveETH: 0,
    token0Price: 0,
    token1Price: 0,
    volumeToken0: 0,
    volumeToken1: 0,
    volumeUSD: 0,
    untrackedVolumeUSD: 0,
    txCount: 0n,
    createdAtTimestamp: BigInt(event.timestamp),
    createdAtBlockNumber: BigInt(event.blockNumber)
  })
  
  pairs.set(pairId, pair)
  factory.pairCount += 1
}

function createToken(id: string): Token {
  let symbol = id
  let name = id
  let decimals = 18
  
  let derivedETH = 0
  if (id === WETH_ADDRESS) {
    symbol = 'WETH'
    name = 'Wrapped Ether'
    decimals = 18
    derivedETH = 1 // WETH always has derivedETH = 1
  } else if (id === '0x6b175474e89094c44da98b954eedeac495271d0f') {
    symbol = 'DAI'
    name = 'Dai Stablecoin'
    decimals = 18
  } else if (id === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') {
    symbol = 'USDC'
    name = 'USD Coin'
    decimals = 6
  } else if (id === '0xdac17f958d2ee523a2206206994597c13d831ec7') {
    symbol = 'USDT'
    name = 'Tether USD'
    decimals = 6
  }
  
  return new Token({
    id,
    symbol,
    name,
    decimals: BigInt(decimals),
    totalSupply: 0n,
    tradeVolume: 0,
    tradeVolumeUSD: 0,
    untrackedVolumeUSD: 0,
    txCount: 0n,
    totalLiquidity: 0,
    derivedETH,
    whitelistPools: []
  })
}

async function handlePairEvent(
  event: ProcessedEvent,
  pair: Pair,
  tokens: Map<string, Token>,
  transactions: Map<string, Transaction>,
  bundle: Bundle
) {
  const transaction = transactions.get(event.txHash)!
  
  if (event.type === 'sync') {
    pair.reserve0 = convertTokenToDecimal(event.data.reserve0, pair.token0.decimals)
    pair.reserve1 = convertTokenToDecimal(event.data.reserve1, pair.token1.decimals)
    
    pair.token0Price = pair.reserve0 > 0 ? pair.reserve1 / pair.reserve0 : 0
    pair.token1Price = pair.reserve1 > 0 ? pair.reserve0 / pair.reserve1 : 0
  }
  
  else if (event.type === 'mint') {
    const mint = new Mint({
      id: `${event.txHash}-${event.logIndex}`,
      transaction,
      pair,
      timestamp: BigInt(event.timestamp),
      to: event.data.to || event.data.sender || '0x0000000000000000000000000000000000000000',
      liquidity: convertTokenToDecimal(event.data.liquidity, 18n),
      sender: event.data.sender || null,
      amount0: event.data.amount0 ? convertTokenToDecimal(event.data.amount0, pair.token0.decimals) : null,
      amount1: event.data.amount1 ? convertTokenToDecimal(event.data.amount1, pair.token1.decimals) : null,
      logIndex: BigInt(event.logIndex),
      amountUSD: null // calc later
    })
    
    transactions.set(`mint-${mint.id}`, mint as any)
  }
  
  else if (event.type === 'burn') {
    const burn = new Burn({
      id: `${event.txHash}-${event.logIndex}`,
      transaction,
      pair,
      timestamp: BigInt(event.timestamp),
      liquidity: convertTokenToDecimal(event.data.liquidity, 18n),
      sender: event.data.sender || null,
      amount0: event.data.amount0 ? convertTokenToDecimal(event.data.amount0, pair.token0.decimals) : null,
      amount1: event.data.amount1 ? convertTokenToDecimal(event.data.amount1, pair.token1.decimals) : null,
      to: event.data.to || null,
      logIndex: BigInt(event.logIndex),
      amountUSD: null // calc later
    })
    
    transactions.set(`burn-${burn.id}`, burn as any)
  }
  
  else if (event.type === 'swap') {
    const swap = new Swap({
      id: `${event.txHash}-${event.logIndex}`,
      transaction,
      pair,
      timestamp: BigInt(event.timestamp),
      sender: event.data.sender,
      from: event.data.from || event.data.sender,
      amount0In: convertTokenToDecimal(event.data.amount0In, pair.token0.decimals),
      amount1In: convertTokenToDecimal(event.data.amount1In, pair.token1.decimals),
      amount0Out: convertTokenToDecimal(event.data.amount0Out, pair.token0.decimals),
      amount1Out: convertTokenToDecimal(event.data.amount1Out, pair.token1.decimals),
      to: event.data.to,
      logIndex: BigInt(event.logIndex),
      amountUSD: 0 // calc later
    })
    
    transactions.set(`swap-${swap.id}`, swap as any)
  }
}

async function updatePricing(store: Store, bundle: Bundle, pairs: Map<string, Pair>) {
  const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'
  const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'

  let bestPrice = 0
  let bestLiquidity = 0

  for (const pair of pairs.values()) {
    if (pair.reserve0 > 0 && pair.reserve1 > 0) {
      let ethPrice = 0
      let ethLiquidity = 0

      // DAI/WETH
      if (pair.token0.id === DAI_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        ethPrice = pair.reserve0 / pair.reserve1
        ethLiquidity = pair.reserve1
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === DAI_ADDRESS) {
        ethPrice = pair.reserve1 / pair.reserve0
        ethLiquidity = pair.reserve0
      }
      // USDC/WETH
      else if (pair.token0.id === USDC_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        ethPrice = pair.reserve0 / pair.reserve1
        ethLiquidity = pair.reserve1
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === USDC_ADDRESS) {
        ethPrice = pair.reserve1 / pair.reserve0
        ethLiquidity = pair.reserve0
      }
      // USDT/WETH
      else if (pair.token0.id === USDT_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        ethPrice = pair.reserve0 / pair.reserve1
        ethLiquidity = pair.reserve1
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === USDT_ADDRESS) {
        ethPrice = pair.reserve1 / pair.reserve0
        ethLiquidity = pair.reserve0
      }

      if (ethPrice > 0 && ethLiquidity > bestLiquidity) {
        bestPrice = ethPrice
        bestLiquidity = ethLiquidity
      }
    }
  }

  if (bestPrice > 0) {
    bundle.ethPrice = bestPrice
  }

  for (const pair of pairs.values()) {
    updateTokenPrices(pair, bundle.ethPrice)
  }
}

function updateTokenPrices(pair: Pair, ethPriceUSD: number) {
  if (pair.token0.id === WETH_ADDRESS) {
    pair.token0.derivedETH = 1
  }
  if (pair.token1.id === WETH_ADDRESS) {
    pair.token1.derivedETH = 1
  }
// trying to keep the data clean here
  if (pair.reserve0 > 0 && pair.reserve1 > 0) {
    if (pair.token0.id === WETH_ADDRESS && pair.token1.id !== WETH_ADDRESS && pair.reserve0 > 0.1) {
      const derivedETH = pair.reserve0 / pair.reserve1
      if (derivedETH > 0.000001 && derivedETH < 1000) {
        pair.token1.derivedETH = derivedETH
      }
    } else if (pair.token1.id === WETH_ADDRESS && pair.token0.id !== WETH_ADDRESS && pair.reserve1 > 0.1) {
      const derivedETH = pair.reserve1 / pair.reserve0
      if (derivedETH > 0.000001 && derivedETH < 1000) {
        pair.token0.derivedETH = derivedETH
      }
    }

    if (STABLE_COINS.includes(pair.token0.id) && ethPriceUSD > 0) {
      pair.token0.derivedETH = 1 / ethPriceUSD
    }
    if (STABLE_COINS.includes(pair.token1.id) && ethPriceUSD > 0) {
      pair.token1.derivedETH = 1 / ethPriceUSD
    }

    const token0DerivedETH = Math.min(Math.max(pair.token0.derivedETH, 0), 1000)
    const token1DerivedETH = Math.min(Math.max(pair.token1.derivedETH, 0), 1000)

    pair.reserveETH = pair.reserve0 * token0DerivedETH + pair.reserve1 * token1DerivedETH
    pair.reserveUSD = Math.min(pair.reserveETH * ethPriceUSD, 100000000) // Cap at $100M

    const trackedLiquidityUSD = getTrackedLiquidityUSD(
      pair.reserve0, pair.token0.id,
      pair.reserve1, pair.token1.id,
      { ethPriceUSD },
      pair.token0.derivedETH,
      pair.token1.derivedETH
    )
    pair.trackedReserveETH = ethPriceUSD > 0 ? trackedLiquidityUSD / ethPriceUSD : 0
  }
}

async function calculateUSDValues(
  pairs: Map<string, Pair>,
  bundle: Bundle,
  transactions: Map<string, Transaction>
) {
  for (const [key, entity] of transactions) {
    if (key.startsWith('mint-')) {
      const mint = entity as any as Mint
      if (mint.amount0 && mint.amount1) {
        const token0DerivedETH = Math.min(Math.max(mint.pair.token0.derivedETH, 0), 1000)
        const token1DerivedETH = Math.min(Math.max(mint.pair.token1.derivedETH, 0), 1000)

        const token0USD = mint.amount0 * token0DerivedETH * bundle.ethPrice
        const token1USD = mint.amount1 * token1DerivedETH * bundle.ethPrice
        mint.amountUSD = Math.min(token0USD + token1USD, 10000000) // Cap at $10M
      }
    }
    else if (key.startsWith('burn-')) {
      const burn = entity as any as Burn
      if (burn.amount0 && burn.amount1) {
        const token0DerivedETH = Math.min(Math.max(burn.pair.token0.derivedETH, 0), 1000)
        const token1DerivedETH = Math.min(Math.max(burn.pair.token1.derivedETH, 0), 1000)

        const token0USD = burn.amount0 * token0DerivedETH * bundle.ethPrice
        const token1USD = burn.amount1 * token1DerivedETH * bundle.ethPrice
        burn.amountUSD = Math.min(token0USD + token1USD, 10000000)
      }
    }
    else if (key.startsWith('swap-')) {
      const swap = entity as any as Swap
      const pair = swap.pair

      const amount0Total = swap.amount0In + swap.amount0Out
      const amount1Total = swap.amount1In + swap.amount1Out

      const amount0USD = amount0Total * pair.token0.derivedETH * bundle.ethPrice
      const amount1USD = amount1Total * pair.token1.derivedETH * bundle.ethPrice

      const trackedAmountUSD = getTrackedVolumeUSD(
        pair.token0.id,
        amount0USD,
        pair.token1.id,
        amount1USD
      )

      swap.amountUSD = trackedAmountUSD

      pair.volumeToken0 += amount0Total
      pair.volumeToken1 += amount1Total
      pair.volumeUSD += trackedAmountUSD
      pair.txCount += 1n

      pair.token0.tradeVolume += amount0Total
      pair.token0.tradeVolumeUSD += trackedAmountUSD / 2
      pair.token0.txCount += 1n

      pair.token1.tradeVolume += amount1Total
      pair.token1.tradeVolumeUSD += trackedAmountUSD / 2
      pair.token1.txCount += 1n
    }
  }
}

function updateFactoryStats(
  factory: UniswapFactory,
  pairs: Map<string, Pair>,
  transactions: Map<string, Transaction>
) {
  let totalVolumeUSD = 0
  let totalVolumeETH = 0
  let totalLiquidityUSD = 0
  let totalLiquidityETH = 0
  let txCount = 0

  for (const pair of pairs.values()) {
    totalVolumeUSD += pair.volumeUSD
    totalVolumeETH += pair.volumeUSD > 0 ? pair.volumeUSD / 213.98 : 0
    totalLiquidityUSD += pair.reserveUSD
    totalLiquidityETH += pair.reserveETH
    txCount += Number(pair.txCount)
  }

  factory.totalVolumeUSD = totalVolumeUSD
  factory.totalVolumeETH = totalVolumeETH
  factory.totalLiquidityUSD = totalLiquidityUSD
  factory.totalLiquidityETH = totalLiquidityETH
  factory.txCount = BigInt(txCount)
}

async function saveEntities(
  store: Store,
  entities: {
    factory: UniswapFactory
    bundle: Bundle
    tokens: Map<string, Token>
    pairs: Map<string, Pair>
    transactions: Map<string, Transaction>
  }
) {
  await store.save([entities.bundle])
  await store.save([entities.factory])
  await store.save([...entities.tokens.values()])
  await store.save([...entities.pairs.values()])

  const transactions: Transaction[] = []
  const mints: Mint[] = []
  const burns: Burn[] = []
  const swaps: Swap[] = []

  for (const [key, entity] of entities.transactions) {
    if (key.startsWith('mint-')) {
      mints.push(entity as any)
    } else if (key.startsWith('burn-')) {
      burns.push(entity as any)
    } else if (key.startsWith('swap-')) {
      swaps.push(entity as any)
    } else {
      transactions.push(entity)
    }
  }

  await store.insert(transactions)
  await store.insert(mints)
  await store.insert(burns)
  await store.insert(swaps)
}

function logProgress(
  ctx: DataHandlerContext<Store>,
  factory: UniswapFactory,
  bundle: Bundle,
  transactions: Map<string, Transaction>
) {
  const swapCount = [...transactions.keys()].filter(k => k.startsWith('swap-')).length
  const mintCount = [...transactions.keys()].filter(k => k.startsWith('mint-')).length
  const burnCount = [...transactions.keys()].filter(k => k.startsWith('burn-')).length

  const startBlock = ctx.blocks[0]?.header.height || 0
  const endBlock = ctx.blocks[ctx.blocks.length - 1]?.header.height || 0

  ctx.log.info(`Block ${startBlock}-${endBlock}: ${swapCount} swaps, ${mintCount} mints, ${burnCount} burns`)
  ctx.log.info(`Total: ${factory.pairCount} pairs, $${factory.totalVolumeUSD.toFixed(0)} volume, ETH price: $${bundle.ethPrice.toFixed(2)}`)
}
