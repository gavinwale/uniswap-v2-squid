import { TypeormDatabase } from '@subsquid/typeorm-store'
import { DataHandlerContext } from '@subsquid/evm-processor'
import { processor } from './config'
import { processBlocks } from './mappings/processor'

processor.run(new TypeormDatabase(), async (ctx) => {
  await processBlocks(ctx)
})
