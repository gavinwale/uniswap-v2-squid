import {TypeormDatabase} from '@subsquid/typeorm-store'
import {Pair, Swap, Mint, Burn, PairStats} from './model'
import {processor, UNISWAP_V2_FACTORY} from './processor'
import {events as factoryEvents} from './abi/uniswapV2Factory'
import {events as pairEvents} from './abi/uniswapV2Pair'

let knownPairs: Set<string>

processor.run(new TypeormDatabase({supportHotBlocks: true}), async (ctx) => {
    if (!knownPairs) {
        const existingPairs = await ctx.store.findBy(Pair, {})
        knownPairs = new Set(existingPairs.map(p => p.pairAddress.toLowerCase()))
        ctx.log.info(`Loaded ${knownPairs.size} existing pairs from database`)
    }

    const pairs: Pair[] = []
    const swaps: Swap[] = []
    const mints: Mint[] = []
    const burns: Burn[] = []

    const statsUpdates = new Map<string, {
        swapCount: number,
        mintCount: number,
        burnCount: number,
        volumeToken0: bigint,
        volumeToken1: bigint,
        lastActivity: Date
    }>()

    // OPTIMIZED
    const newPairsInBatch = new Set<string>()

    for (let c of ctx.blocks) {
        for (let log of c.logs) {
            if (log.address.toLowerCase() === UNISWAP_V2_FACTORY.toLowerCase() && log.topics[0] === factoryEvents.PairCreated.topic) {
                const {token0, token1, pair, allPairsLength} = factoryEvents.PairCreated.decode(log)
                const pairAddress = pair.toLowerCase()

                pairs.push(
                    new Pair({
                        id: log.id,
                        token0: token0.toLowerCase(),
                        token1: token1.toLowerCase(),
                        pairAddress: pairAddress,
                        block: c.header.height,
                        txHash: log.transactionHash,
                        timestamp: new Date(c.header.timestamp),
                        allPairsLength: allPairsLength,
                    })
                )

                knownPairs.add(pairAddress)
                newPairsInBatch.add(pairAddress)
            }
        }
    }

    for (let c of ctx.blocks) {
        for (let log of c.logs) {
            if (knownPairs.has(log.address.toLowerCase()) &&
               (log.topics[0] === pairEvents.Swap.topic ||
                log.topics[0] === pairEvents.Mint.topic ||
                log.topics[0] === pairEvents.Burn.topic)) {

                const pairAddress = log.address.toLowerCase()
                const timestamp = new Date(c.header.timestamp)

                try {

                if (!statsUpdates.has(pairAddress)) {
                    statsUpdates.set(pairAddress, {
                        swapCount: 0,
                        mintCount: 0,
                        burnCount: 0,
                        volumeToken0: 0n,
                        volumeToken1: 0n,
                        lastActivity: timestamp
                    })
                }
                const stats = statsUpdates.get(pairAddress)!

                if (log.topics[0] === pairEvents.Swap.topic) {
                    const {sender, amount0In, amount1In, amount0Out, amount1Out, to} = pairEvents.Swap.decode(log)

                    swaps.push(
                        new Swap({
                            id: log.id,
                            pair: pairAddress,
                            sender: sender.toLowerCase(),
                            amount0In: amount0In,
                            amount1In: amount1In,
                            amount0Out: amount0Out,
                            amount1Out: amount1Out,
                            to: to.toLowerCase(),
                            block: c.header.height,
                            txHash: log.transactionHash,
                            timestamp: timestamp,
                        })
                    )

                    stats.swapCount++
                    stats.volumeToken0 += amount0In + amount0Out
                    stats.volumeToken1 += amount1In + amount1Out
                    stats.lastActivity = timestamp

                } else if (log.topics[0] === pairEvents.Mint.topic) {
                    const {sender, amount0, amount1} = pairEvents.Mint.decode(log)

                    mints.push(
                        new Mint({
                            id: log.id,
                            pair: pairAddress,
                            sender: sender.toLowerCase(),
                            amount0: amount0,
                            amount1: amount1,
                            block: c.header.height,
                            txHash: log.transactionHash,
                            timestamp: timestamp,
                        })
                    )

                    stats.mintCount++
                    stats.lastActivity = timestamp

                } else if (log.topics[0] === pairEvents.Burn.topic) {
                    const {sender, amount0, amount1, to} = pairEvents.Burn.decode(log)

                    burns.push(
                        new Burn({
                            id: log.id,
                            pair: pairAddress,
                            sender: sender.toLowerCase(),
                            amount0: amount0,
                            amount1: amount1,
                            to: to.toLowerCase(),
                            block: c.header.height,
                            txHash: log.transactionHash,
                            timestamp: timestamp,
                        })
                    )

                    stats.burnCount++
                    stats.lastActivity = timestamp
                }

                knownPairs.add(pairAddress)

                } catch (error) {
                    continue
                }
            }
        }
    }

    const pairStatsToUpdate: PairStats[] = []
    for (const [pairAddress, updates] of statsUpdates) {
        let pairStats = await ctx.store.get(PairStats, pairAddress)

        if (!pairStats) {
            pairStats = new PairStats({
                id: pairAddress,
                totalSwaps: 0,
                totalMints: 0,
                totalBurns: 0,
                firstActivity: updates.lastActivity,
                lastActivity: updates.lastActivity,
                totalVolumeToken0: 0n,
                totalVolumeToken1: 0n,
            })
        }

        pairStats.totalSwaps += updates.swapCount
        pairStats.totalMints += updates.mintCount
        pairStats.totalBurns += updates.burnCount
        pairStats.totalVolumeToken0 += updates.volumeToken0
        pairStats.totalVolumeToken1 += updates.volumeToken1
        pairStats.lastActivity = updates.lastActivity

        pairStatsToUpdate.push(pairStats)
    }

    const startBlock = ctx.blocks.at(0)?.header.height
    const endBlock = ctx.blocks.at(-1)?.header.height
    ctx.log.info(`Processed ${pairs.length} pairs, ${swaps.length} swaps, ${mints.length} mints, ${burns.length} burns from block ${startBlock} to ${endBlock}`)
    ctx.log.info(`Known pairs: ${knownPairs.size}, New pairs: ${newPairsInBatch.size}`)

    if (pairs.length > 0) {
        await ctx.store.insert(pairs)
    }
    if (swaps.length > 0) {
        await ctx.store.insert(swaps)
    }
    if (mints.length > 0) {
        await ctx.store.insert(mints)
    }
    if (burns.length > 0) {
        await ctx.store.insert(burns)
    }
    if (pairStatsToUpdate.length > 0) {
        await ctx.store.upsert(pairStatsToUpdate)
    }
})
