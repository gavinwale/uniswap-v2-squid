import { TypeormDatabase } from '@subsquid/typeorm-store'
import { DataHandlerContext, BlockData } from '@subsquid/evm-processor'
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
import { processor } from './processor'
import { EntityManager } from './utils/entityManager'
import { processFactory } from './mappings/factory'
import { processPairs } from './mappings/core'

type ContextWithEntityManager = DataHandlerContext<any> & {
  entities: EntityManager
}

processor.run(new TypeormDatabase(), async (ctx) => {
  const entities = new EntityManager(ctx.store)
  const entitiesCtx: ContextWithEntityManager = { ...ctx, entities }



  // Process factory events (pair creation)
  await processFactory(entitiesCtx, ctx.blocks)

  // Process pair events (swaps, mints, burns, syncs)
  await processPairs(entitiesCtx, ctx.blocks)

  // Save all entities in optimized order
  await ctx.store.save(entities.values(Bundle))
  await ctx.store.save(entities.values(UniswapFactory))
  await ctx.store.save(entities.values(Token))
  await ctx.store.save(entities.values(Pair))
  await ctx.store.insert(entities.values(Transaction))
  await ctx.store.insert(entities.values(Mint))
  await ctx.store.insert(entities.values(Burn))
  await ctx.store.insert(entities.values(Swap))

  // Log final summary
  const factory = entities.values(UniswapFactory)[0]
  const bundle = entities.values(Bundle)[0]
  if (factory && bundle) {
    ctx.log.info(`Block ${ctx.blocks[0]?.header.height}-${ctx.blocks[ctx.blocks.length - 1]?.header.height}: ${entities.values(Swap).length} swaps, ${entities.values(Mint).length} mints, ${entities.values(Burn).length} burns`)
    ctx.log.info(`Total: ${factory.pairCount} pairs, $${factory.totalVolumeUSD.toFixed(0)} volume, ETH price: $${bundle.ethPrice.toFixed(2)}`)
  }
})




