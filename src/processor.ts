import {
    BlockHeader,
    DataHandlerContext,
    EvmBatchProcessor,
    EvmBatchProcessorFields,
    Log as _Log,
    Transaction as _Transaction,
} from '@subsquid/evm-processor'
import {events as factoryEvents} from './abi/uniswapV2Factory'
import {events as pairEvents} from './abi/uniswapV2Pair'

export const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'

export const processor = new EvmBatchProcessor()
    .setGateway('https://v2.archive.subsquid.io/network/ethereum-mainnet')
    .setFinalityConfirmation(100)
    .setFields({
        log: {
            transactionHash: true,
            data: true,
            topics: true,
            blockNumber: true,
            blockTimestamp: true,
        },
    })
    .setBlockRange({
        from: 10000835, // Uniswap V2 Factory deployment
        to: 14000000, // Adjust this value to the latest block you want to index
    })
    .addLog({
        address: [UNISWAP_V2_FACTORY],
        topic0: [factoryEvents.PairCreated.topic],
    })
    .addLog({
        topic0: [
            pairEvents.Swap.topic,
            pairEvents.Mint.topic,
            pairEvents.Burn.topic,
        ],
    })

export type Fields = EvmBatchProcessorFields<typeof processor>
export type Block = BlockHeader<Fields>
export type Log = _Log<Fields>
export type Transaction = _Transaction<Fields>
export type ProcessorContext<Store> = DataHandlerContext<Store, Fields>
