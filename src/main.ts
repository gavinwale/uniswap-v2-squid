import { TypeormDatabase } from '@subsquid/typeorm-store'
import { BigDecimal } from '@subsquid/big-decimal'
import {
  UniswapFactory,
  Token,
  Pair,
  Transaction,
  Mint,
  Burn,
  Swap,
  Bundle
} from './model'
import { processor, UNISWAP_V2_FACTORY } from './processor'
import { events as factoryEvents } from './abi/uniswapV2Factory'
import { events as pairEvents } from './abi/uniswapV2Pair'

// Constants
const ZERO_BD = BigDecimal('0')
const ONE_BD = BigDecimal('1')
const FACTORY_ADDRESS = UNISWAP_V2_FACTORY.toLowerCase()

// Whitelist for reliable USD pricing (same as Uniswap subgraph)
const WHITELIST = [
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
]

// Removed unused constant

let knownPairs: Set<string>
let allPairs: Map<string, Pair> = new Map()
let allTokens: Map<string, Token> = new Map()

processor.run(new TypeormDatabase({ supportHotBlocks: true }), async (ctx) => {
  // Initialize or load factory entity
  let factory = await ctx.store.get(UniswapFactory, FACTORY_ADDRESS)
  if (!factory) {
    factory = new UniswapFactory({
      id: FACTORY_ADDRESS,
      pairCount: 0,
      totalVolumeETH: ZERO_BD,
      totalLiquidityETH: ZERO_BD,
      totalVolumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      totalLiquidityUSD: ZERO_BD,
      txCount: 0n
    })
    ctx.log.info('Created new factory entity')
  }

  // Initialize or load bundle entity (for ETH price tracking)
  let bundle = await ctx.store.get(Bundle, '1')
  if (!bundle) {
    bundle = new Bundle({
      id: '1',
      ethPrice: ZERO_BD
    })
    ctx.log.info('Created new bundle entity')
  }

  // Load existing data
  if (!knownPairs) {
    const existingPairs = await ctx.store.find(Pair)
    knownPairs = new Set(existingPairs.map(p => p.id))
    for (const pair of existingPairs) {
      allPairs.set(pair.id, pair)
    }

    const existingTokens = await ctx.store.find(Token)
    for (const token of existingTokens) {
      allTokens.set(token.id, token)
    }

    ctx.log.info(`Loaded ${knownPairs.size} pairs and ${allTokens.size} tokens`)
  }

  // Collections for batch processing
  const newPairs: Pair[] = []
  const newTokens: Token[] = []
  const transactions: Transaction[] = []
  const mints: Mint[] = []
  const burns: Burn[] = []
  const swaps: Swap[] = []
  // Removed unused day data updates for now

  const newPairsInBatch = new Set<string>()

  // FIRST PASS: Process PairCreated events
  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      if (log.address.toLowerCase() === FACTORY_ADDRESS &&
          log.topics[0] === factoryEvents.PairCreated.topic) {

        const { token0, token1, pair } = factoryEvents.PairCreated.decode(log)
        const pairAddress = pair.toLowerCase()
        const token0Address = token0.toLowerCase()
        const token1Address = token1.toLowerCase()

        if (knownPairs.has(pairAddress)) continue

        // Create or get tokens with real metadata from contract calls
        let token0Entity = allTokens.get(token0Address)
        if (!token0Entity) {
          const token0Metadata = createTokenMetadata(token0Address)
          token0Entity = new Token({
            id: token0Address,
            symbol: token0Metadata.symbol,
            name: token0Metadata.name,
            decimals: token0Metadata.decimals,
            totalSupply: token0Metadata.totalSupply,
            tradeVolume: ZERO_BD,
            tradeVolumeUSD: ZERO_BD,
            untrackedVolumeUSD: ZERO_BD,
            txCount: 0n,
            totalLiquidity: ZERO_BD,
            derivedETH: ZERO_BD
          })
          allTokens.set(token0Address, token0Entity)
          newTokens.push(token0Entity)
        }

        let token1Entity = allTokens.get(token1Address)
        if (!token1Entity) {
          const token1Metadata = createTokenMetadata(token1Address)
          token1Entity = new Token({
            id: token1Address,
            symbol: token1Metadata.symbol,
            name: token1Metadata.name,
            decimals: token1Metadata.decimals,
            totalSupply: token1Metadata.totalSupply,
            tradeVolume: ZERO_BD,
            tradeVolumeUSD: ZERO_BD,
            untrackedVolumeUSD: ZERO_BD,
            txCount: 0n,
            totalLiquidity: ZERO_BD,
            derivedETH: ZERO_BD
          })
          allTokens.set(token1Address, token1Entity)
          newTokens.push(token1Entity)
        }

        // Create pair
        const pairEntity = new Pair({
          id: pairAddress,
          token0: token0Entity,
          token1: token1Entity,
          reserve0: ZERO_BD,
          reserve1: ZERO_BD,
          totalSupply: ZERO_BD,
          reserveETH: ZERO_BD,
          reserveUSD: ZERO_BD,
          trackedReserveETH: ZERO_BD,
          token0Price: ZERO_BD,
          token1Price: ZERO_BD,
          volumeToken0: ZERO_BD,
          volumeToken1: ZERO_BD,
          volumeUSD: ZERO_BD,
          untrackedVolumeUSD: ZERO_BD,
          txCount: 0n,
          createdAtTimestamp: BigInt(block.header.timestamp),
          createdAtBlockNumber: BigInt(block.header.height),
          liquidityProviderCount: 0n
        })

        allPairs.set(pairAddress, pairEntity)
        newPairs.push(pairEntity)
        knownPairs.add(pairAddress)
        newPairsInBatch.add(pairAddress)
        factory.pairCount += 1

        ctx.log.info(`New pair: ${pairAddress} (${token0Entity.symbol}/${token1Entity.symbol})`)
      }
    }
  }

  // SECOND PASS: Process pair events
  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      const logAddress = log.address.toLowerCase()

      if (!knownPairs.has(logAddress)) continue

      const pair = allPairs.get(logAddress)
      if (!pair) continue

      const timestamp = block.header.timestamp
      const blockNumber = block.header.height

      // Get or create transaction
      const txHash = log.transactionHash
      let transaction = transactions.find(t => t.id === txHash)
      if (!transaction) {
        transaction = new Transaction({
          id: txHash,
          blockNumber: BigInt(blockNumber),
          timestamp: BigInt(timestamp)
        })
        transactions.push(transaction)
      }

      // Handle different event types
      if (log.topics[0] === pairEvents.Sync.topic) {
        handleSync(log, pair, allTokens, bundle)

        // Update prices after sync events
        bundle.ethPrice = getEthPriceInUSD()
        for (const token of allTokens.values()) {
          token.derivedETH = findEthPerToken(token)
        }

      } else if (log.topics[0] === pairEvents.Mint.topic) {
        handleMint(log, block, transaction, pair, allTokens, bundle, factory, mints)
      } else if (log.topics[0] === pairEvents.Burn.topic) {
        handleBurn(log, block, transaction, pair, allTokens, bundle, factory, burns)
      } else if (log.topics[0] === pairEvents.Swap.topic) {
        handleSwap(log, block, transaction, pair, allTokens, bundle, factory, swaps)
      }
    }
  }

  // Final price update and liquidity calculations
  bundle.ethPrice = getEthPriceInUSD()
  for (const token of allTokens.values()) {
    token.derivedETH = findEthPerToken(token)
  }

  // Update factory liquidity totals
  let totalLiquidityETH = ZERO_BD
  let totalLiquidityUSD = ZERO_BD

  for (const pair of allPairs.values()) {
    totalLiquidityETH = totalLiquidityETH.plus(pair.reserveETH)
    totalLiquidityUSD = totalLiquidityUSD.plus(pair.reserveUSD)
  }

  factory.totalLiquidityETH = totalLiquidityETH
  factory.totalLiquidityUSD = totalLiquidityUSD

  // Save all entities
  if (newTokens.length > 0) await ctx.store.save(newTokens)
  if (newPairs.length > 0) await ctx.store.save(newPairs)
  if (transactions.length > 0) await ctx.store.save(transactions)
  if (mints.length > 0) await ctx.store.save(mints)
  if (burns.length > 0) await ctx.store.save(burns)
  if (swaps.length > 0) await ctx.store.save(swaps)

  await ctx.store.save(factory)
  await ctx.store.save(bundle)

  // Save updated tokens and pairs
  const updatedTokens = Array.from(allTokens.values()).filter(t => !newTokens.includes(t))
  const updatedPairs = Array.from(allPairs.values()).filter(p => !newPairs.includes(p))
  if (updatedTokens.length > 0) await ctx.store.save(updatedTokens)
  if (updatedPairs.length > 0) await ctx.store.save(updatedPairs)

  const startBlock = ctx.blocks.at(0)?.header.height
  const endBlock = ctx.blocks.at(-1)?.header.height
  ctx.log.info(`Processed blocks ${startBlock}-${endBlock}: ${newPairs.length} new pairs, ${swaps.length} swaps, ${mints.length} mints, ${burns.length} burns`)
  ctx.log.info(`Total pairs: ${knownPairs.size}`)
})

// Helper functions
function convertTokenToDecimal(tokenAmount: bigint, decimals: bigint): BigDecimal {
  if (decimals === 0n) {
    return BigDecimal(tokenAmount.toString())
  }
  return BigDecimal(tokenAmount.toString()).div(BigDecimal(10).pow(Number(decimals)))
}

function addressToBytes(address: string): Uint8Array {
  // Remove 0x prefix and convert hex to bytes
  const hex = address.startsWith('0x') ? address.slice(2) : address
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function handleSync(log: any, pair: Pair, tokens: Map<string, Token>, bundle: Bundle): void {
  const { reserve0, reserve1 } = pairEvents.Sync.decode(log)

  const token0 = tokens.get(pair.token0.id)!
  const token1 = tokens.get(pair.token1.id)!

  // Update reserves
  pair.reserve0 = convertTokenToDecimal(reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(reserve1, token1.decimals)

  // Update prices (token0Price = reserve1/reserve0, token1Price = reserve0/reserve1)
  if (pair.reserve0.gt(ZERO_BD)) {
    pair.token1Price = pair.reserve1.div(pair.reserve0)
  } else {
    pair.token1Price = ZERO_BD
  }

  if (pair.reserve1.gt(ZERO_BD)) {
    pair.token0Price = pair.reserve0.div(pair.reserve1)
  } else {
    pair.token0Price = ZERO_BD
  }

  // Update derived liquidity using current token prices
  pair.reserveETH = pair.reserve0.times(token0.derivedETH).plus(pair.reserve1.times(token1.derivedETH))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // Calculate tracked liquidity (for whitelisted tokens)
  const trackedLiquidityUSD = getTrackedLiquidityUSD(pair.reserve0, token0, pair.reserve1, token1, bundle)
  pair.trackedReserveETH = bundle.ethPrice.gt(ZERO_BD) ? trackedLiquidityUSD.div(bundle.ethPrice) : ZERO_BD

  // Token liquidity will be calculated separately by summing across all pairs
}

function handleMint(log: any, block: any, transaction: Transaction, pair: Pair, tokens: Map<string, Token>, bundle: Bundle, factory: UniswapFactory, mints: Mint[]): void {
  const { sender, amount0, amount1 } = pairEvents.Mint.decode(log)

  const token0 = tokens.get(pair.token0.id)!
  const token1 = tokens.get(pair.token1.id)!

  const token0Amount = convertTokenToDecimal(amount0, token0.decimals)
  const token1Amount = convertTokenToDecimal(amount1, token1.decimals)

  const mint = new Mint({
    id: `${log.transactionHash}-${mints.length}`,
    transaction: transaction,
    timestamp: BigInt(block.header.timestamp),
    pair: pair,
    to: addressToBytes(sender.toLowerCase()),
    liquidity: ZERO_BD,
    sender: addressToBytes(sender.toLowerCase()),
    amount0: token0Amount,
    amount1: token1Amount,
    logIndex: BigInt(log.logIndex || 0),
    amountUSD: token0Amount.times(token0.derivedETH).plus(token1Amount.times(token1.derivedETH)).times(bundle.ethPrice),
    feeTo: null,
    feeLiquidity: null
  })

  mints.push(mint)

  // Update stats
  pair.txCount += 1n
  token0.txCount += 1n
  token1.txCount += 1n
  factory.txCount += 1n
}

function handleBurn(log: any, block: any, transaction: Transaction, pair: Pair, tokens: Map<string, Token>, bundle: Bundle, factory: UniswapFactory, burns: Burn[]): void {
  const { sender, amount0, amount1, to } = pairEvents.Burn.decode(log)

  const token0 = tokens.get(pair.token0.id)!
  const token1 = tokens.get(pair.token1.id)!

  const token0Amount = convertTokenToDecimal(amount0, token0.decimals)
  const token1Amount = convertTokenToDecimal(amount1, token1.decimals)

  const burn = new Burn({
    id: `${log.transactionHash}-${burns.length}`,
    transaction: transaction,
    timestamp: BigInt(block.header.timestamp),
    pair: pair,
    liquidity: ZERO_BD,
    sender: addressToBytes(sender.toLowerCase()),
    amount0: token0Amount,
    amount1: token1Amount,
    to: addressToBytes(to.toLowerCase()),
    logIndex: BigInt(log.logIndex || 0),
    amountUSD: token0Amount.times(token0.derivedETH).plus(token1Amount.times(token1.derivedETH)).times(bundle.ethPrice),
    needsComplete: false,
    feeTo: null,
    feeLiquidity: null
  })

  burns.push(burn)

  // Update stats
  pair.txCount += 1n
  token0.txCount += 1n
  token1.txCount += 1n
  factory.txCount += 1n
}

function handleSwap(log: any, block: any, transaction: Transaction, pair: Pair, tokens: Map<string, Token>, bundle: Bundle, factory: UniswapFactory, swaps: Swap[]): void {
  const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = pairEvents.Swap.decode(log)

  const token0 = tokens.get(pair.token0.id)!
  const token1 = tokens.get(pair.token1.id)!

  const amount0InDecimal = convertTokenToDecimal(amount0In, token0.decimals)
  const amount1InDecimal = convertTokenToDecimal(amount1In, token1.decimals)
  const amount0OutDecimal = convertTokenToDecimal(amount0Out, token0.decimals)
  const amount1OutDecimal = convertTokenToDecimal(amount1Out, token1.decimals)

  // Calculate total amounts (this is the volume)
  const amount0Total = amount0InDecimal.plus(amount0OutDecimal)
  const amount1Total = amount1InDecimal.plus(amount1OutDecimal)

  // Calculate USD amounts using current prices
  const derivedAmountETH = token0.derivedETH.times(amount0Total).plus(token1.derivedETH.times(amount1Total)).div(BigDecimal('2'))
  const derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)
  const trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0, amount1Total, token1, bundle)

  // Use tracked amount if available, otherwise use derived
  const finalAmountUSD = trackedAmountUSD.gt(ZERO_BD) ? trackedAmountUSD : derivedAmountUSD

  const swap = new Swap({
    id: `${log.transactionHash}-${swaps.length}`,
    transaction: transaction,
    timestamp: BigInt(block.header.timestamp),
    pair: pair,
    sender: addressToBytes(sender.toLowerCase()),
    from: addressToBytes(sender.toLowerCase()),
    amount0In: amount0InDecimal,
    amount1In: amount1InDecimal,
    amount0Out: amount0OutDecimal,
    amount1Out: amount1OutDecimal,
    to: addressToBytes(to.toLowerCase()),
    logIndex: BigInt(log.logIndex || 0),
    amountUSD: finalAmountUSD
  })

  swaps.push(swap)

  // Update pair volume (CRITICAL for volume tracking)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
  pair.volumeUSD = pair.volumeUSD.plus(finalAmountUSD)
  pair.untrackedVolumeUSD = pair.untrackedVolumeUSD.plus(derivedAmountUSD)
  pair.txCount += 1n

  // Update token volume (CRITICAL for token stats)
  token0.tradeVolume = token0.tradeVolume.plus(amount0Total)
  token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(finalAmountUSD.div(BigDecimal('2'))) // Split USD volume
  token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(derivedAmountUSD.div(BigDecimal('2')))
  token0.txCount += 1n

  token1.tradeVolume = token1.tradeVolume.plus(amount1Total)
  token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(finalAmountUSD.div(BigDecimal('2'))) // Split USD volume
  token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(derivedAmountUSD.div(BigDecimal('2')))
  token1.txCount += 1n

  // Update factory volume (CRITICAL for protocol stats)
  const trackedAmountETH = bundle.ethPrice.gt(ZERO_BD) ? finalAmountUSD.div(bundle.ethPrice) : ZERO_BD
  factory.totalVolumeUSD = factory.totalVolumeUSD.plus(finalAmountUSD)
  factory.totalVolumeETH = factory.totalVolumeETH.plus(trackedAmountETH)
  factory.untrackedVolumeUSD = factory.untrackedVolumeUSD.plus(derivedAmountUSD)
  factory.txCount += 1n
}

// Pricing helper functions
function findEthPerToken(token: Token): BigDecimal {
  const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

  if (token.id === WETH_ADDRESS) {
    return ONE_BD // WETH = 1 ETH
  }

  // For whitelist tokens, calculate ETH value based on USD price
  if (WHITELIST.includes(token.id)) {
    const ethPriceUSD = getEthPriceInUSD()
    if (ethPriceUSD.gt(ZERO_BD)) {
      // For stablecoins (USDC, DAI, USDT), 1 token ≈ 1 USD
      if (token.id === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' || // USDC
          token.id === '0x6b175474e89094c44da98b954eedeac495271d0f' || // DAI
          token.id === '0xdac17f958d2ee523a2206206994597c13d831ec7') { // USDT
        return ONE_BD.div(ethPriceUSD) // 1 USD / ETH_price_USD = ETH per token
      }
    }
  }

  // For other tokens, look for pairs with WETH
  let bestLiquidity = ZERO_BD
  let bestPrice = ZERO_BD

  for (const pair of allPairs.values()) {
    if (pair.reserve0.gt(ZERO_BD) && pair.reserve1.gt(ZERO_BD)) {

      if (pair.token0.id === token.id && pair.token1.id === WETH_ADDRESS) {
        // Token/WETH pair, token is token0
        // Price = reserve1/reserve0 = WETH per token = ETH per token
        const liquidity = pair.reserveETH
        if (liquidity.gt(bestLiquidity)) {
          bestLiquidity = liquidity
          bestPrice = pair.reserve1.div(pair.reserve0)
        }
      } else if (pair.token1.id === token.id && pair.token0.id === WETH_ADDRESS) {
        // WETH/Token pair, token is token1
        // Price = reserve0/reserve1 = WETH per token = ETH per token
        const liquidity = pair.reserveETH
        if (liquidity.gt(bestLiquidity)) {
          bestLiquidity = liquidity
          bestPrice = pair.reserve0.div(pair.reserve1)
        }
      }
    }
  }

  return bestPrice
}

function getEthPriceInUSD(): BigDecimal {
  const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'
  const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'

  let bestPrice = ZERO_BD
  let bestLiquidity = ZERO_BD

  // Look through all pairs to find WETH paired with stablecoins
  for (const pair of allPairs.values()) {
    if (pair.reserve0.gt(ZERO_BD) && pair.reserve1.gt(ZERO_BD)) {
      let ethPrice = ZERO_BD
      let liquidityUSD = ZERO_BD

      // DAI/WETH pair (prioritize this - most liquid in early days)
      if (pair.token0.id === DAI_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        // DAI is token0, WETH is token1: price = DAI_reserve / WETH_reserve
        ethPrice = pair.reserve0.div(pair.reserve1)
        liquidityUSD = pair.reserve0 // DAI reserve as liquidity measure
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === DAI_ADDRESS) {
        // WETH is token0, DAI is token1: price = DAI_reserve / WETH_reserve
        ethPrice = pair.reserve1.div(pair.reserve0)
        liquidityUSD = pair.reserve1 // DAI reserve as liquidity measure
      }

      // USDC/WETH pair
      else if (pair.token0.id === USDC_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        // USDC is token0, WETH is token1: price = USDC_reserve / WETH_reserve
        ethPrice = pair.reserve0.div(pair.reserve1)
        liquidityUSD = pair.reserve0 // USDC reserve as liquidity measure
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === USDC_ADDRESS) {
        // WETH is token0, USDC is token1: price = USDC_reserve / WETH_reserve
        ethPrice = pair.reserve1.div(pair.reserve0)
        liquidityUSD = pair.reserve1 // USDC reserve as liquidity measure
      }

      // USDT/WETH pair
      else if (pair.token0.id === USDT_ADDRESS && pair.token1.id === WETH_ADDRESS) {
        // USDT is token0, WETH is token1: price = USDT_reserve / WETH_reserve
        ethPrice = pair.reserve0.div(pair.reserve1)
        liquidityUSD = pair.reserve0 // USDT reserve as liquidity measure
      } else if (pair.token0.id === WETH_ADDRESS && pair.token1.id === USDT_ADDRESS) {
        // WETH is token0, USDT is token1: price = USDT_reserve / WETH_reserve
        ethPrice = pair.reserve1.div(pair.reserve0)
        liquidityUSD = pair.reserve1 // USDT reserve as liquidity measure
      }

      // Use the pair with the highest liquidity
      if (ethPrice.gt(ZERO_BD) && liquidityUSD.gt(bestLiquidity)) {
        bestPrice = ethPrice
        bestLiquidity = liquidityUSD
      }
    }
  }

  // Return best price found, or fallback
  return bestPrice.gt(ZERO_BD) ? bestPrice : BigDecimal('300')
}

function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  bundle: Bundle
): BigDecimal {
  const price0USD = token0.derivedETH.times(bundle.ethPrice)
  const price1USD = token1.derivedETH.times(bundle.ethPrice)

  // Both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD)).div(BigDecimal('2'))
  }

  // Take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0USD)
  }

  // Take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1USD)
  }

  // Neither token is on whitelist, tracked volume is 0
  return ZERO_BD
}

function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  bundle: Bundle
): BigDecimal {
  const price0 = token0.derivedETH.times(bundle.ethPrice)
  const price1 = token1.derivedETH.times(bundle.ethPrice)

  // Both are whitelist tokens, return sum of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // Take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal('2'))
  }

  // Take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal('2'))
  }

  // Neither token is on whitelist, tracked liquidity is 0
  return ZERO_BD
}

// Token metadata with correct decimals for major tokens
function createTokenMetadata(tokenAddress: string): {
  symbol: string,
  name: string,
  decimals: bigint,
  totalSupply: bigint
} {
  const addr = tokenAddress.toLowerCase()
  const shortAddress = tokenAddress.slice(0, 6) + '...' + tokenAddress.slice(-4)

  // Major tokens with correct decimals
  const knownTokens: Record<string, { symbol: string, name: string, decimals: bigint }> = {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18n },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', name: 'USD Coin', decimals: 6n },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18n },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', name: 'Tether USD', decimals: 6n },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8n },
  }

  const known = knownTokens[addr]
  if (known) {
    return {
      symbol: known.symbol,
      name: known.name,
      decimals: known.decimals,
      totalSupply: 0n
    }
  }

  return {
    symbol: shortAddress,
    name: `Token ${shortAddress}`,
    decimals: 18n,
    totalSupply: 0n
  }
}
