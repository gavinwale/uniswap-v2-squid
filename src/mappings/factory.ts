import { DataHandlerContext, BlockData } from '@subsquid/evm-processor'
import { EntityManager } from '../utils/entityManager'
import { BlockMap } from '../utils/blockMap'
import { events as factoryEvents } from '../abi/uniswapV2Factory'
import { UniswapFactory, Token, Pair, Bundle } from '../model'
import { FACTORY_ADDRESS, TOKEN_DECIMALS, TOKEN_SYMBOLS, TOKEN_NAMES } from '../utils/constants'
import { WHITELIST_TOKENS } from '../utils/pricing'
import { last } from '../utils/tools'

interface PairCreatedData {
  pairId: string
  token0Id: string
  token1Id: string
}

type ContextWithEntityManager = DataHandlerContext<any> & {
  entities: EntityManager
}

export async function processFactory(
  ctx: ContextWithEntityManager,
  blocks: BlockData[]
): Promise<void> {
  const newPairsData = await processItems(ctx, blocks)
  
  if (newPairsData.size === 0) return

  await prefetch(ctx, newPairsData)

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

  for (const [block, blockEventsData] of newPairsData) {
    for (const data of blockEventsData) {
      const pair = createPair(data.pairId, data.token0Id, data.token1Id)
      pair.createdAtTimestamp = BigInt(block.timestamp)
      pair.createdAtBlockNumber = BigInt(block.height)
      ctx.entities.add(pair)

      let token0 = ctx.entities.get(Token, data.token0Id, false)
      if (!token0) {
        token0 = createToken(data.token0Id)
        ctx.entities.add(token0)
      }

      let token1 = ctx.entities.get(Token, data.token1Id, false)
      if (!token1) {
        token1 = createToken(data.token1Id)
        ctx.entities.add(token1)
      }

      // Update whitelist pools
      if (WHITELIST_TOKENS.includes(token0.id)) {
        token1.whitelistPools.push(pair.id)
      }
      if (WHITELIST_TOKENS.includes(token1.id)) {
        token0.whitelistPools.push(pair.id)
      }

      factory.pairCount += 1

      // Log progress every 1000 pairs
      if (factory.pairCount % 1000 === 0) {
        ctx.log.info(`Created ${factory.pairCount} pairs`)
      }
    }
  }
}

async function prefetch(
  ctx: ContextWithEntityManager,
  eventsData: BlockMap<PairCreatedData>
) {
  for (const [, blockEventsData] of eventsData) {
    for (const data of blockEventsData) {
      ctx.entities.defer(Token, data.token0Id, data.token1Id)
    }
  }
  await ctx.entities.load(Token)
}

async function processItems(
  ctx: ContextWithEntityManager,
  blocks: BlockData[]
) {
  let newPairsData = new BlockMap<PairCreatedData>()
  
  for (let block of blocks) {
    for (let log of block.logs) {
      if (
        log.topics[0] === factoryEvents.PairCreated.topic &&
        log.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase()
      ) {
        const event = factoryEvents.PairCreated.decode(log)
        newPairsData.push(block.header, {
          pairId: event.pair.toLowerCase(),
          token0Id: event.token0.toLowerCase(),
          token1Id: event.token1.toLowerCase(),
        })
      }
    }
  }
  
  return newPairsData
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

function createToken(id: string) {
  const token = new Token({ id })
  const addr = id.toLowerCase()
  
  // Use known metadata if available
  token.symbol = TOKEN_SYMBOLS[addr] || `${id.slice(0, 6)}...${id.slice(-4)}`
  token.name = TOKEN_NAMES[addr] || `Token ${token.symbol}`
  token.decimals = BigInt(TOKEN_DECIMALS[addr] || 18)
  token.totalSupply = 0n
  
  token.derivedETH = 0
  token.tradeVolume = 0
  token.tradeVolumeUSD = 0
  token.untrackedVolumeUSD = 0
  token.totalLiquidity = 0
  token.txCount = 0n
  token.whitelistPools = []
  
  return token
}

function createBundle(id: string) {
  const bundle = new Bundle({ id })
  bundle.ethPrice = 0
  return bundle
}

function createPair(id: string, token0Id: string, token1Id: string) {
  const pair = new Pair({ id })
  pair.token0 = { id: token0Id } as Token
  pair.token1 = { id: token1Id } as Token
  
  pair.reserve0 = 0
  pair.reserve1 = 0
  pair.totalSupply = 0
  pair.reserveETH = 0
  pair.reserveUSD = 0
  pair.trackedReserveETH = 0
  pair.token0Price = 0
  pair.token1Price = 0
  pair.volumeToken0 = 0
  pair.volumeToken1 = 0
  pair.volumeUSD = 0
  pair.untrackedVolumeUSD = 0
  pair.txCount = 0n
  pair.liquidityProviderCount = 0n
  
  return pair
}
