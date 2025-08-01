# Uniswap V2 Indexer

A high-performance Uniswap V2 data indexer built with [Subsquid](https://subsquid.io). Efficiently indexes all trading pairs, swaps, mints, burns using an optimized factory pattern for fast sync times.

## Quick Start

Prerequisites
(On Windows) WSL
Node.js v18+
Git
Docker (for running Postgres)

```bash
# Install dependencies
npm install

# Start local database
sqd up

# Generate TypeORM models
sqd codegen

# Build the project
sqd build

# Generate and apply database migrations
sqd migration:generate
sqd migration:apply

# Start indexing (this will take a while for full sync)
sqd process

# In another terminal, start GraphQL server
sqd serve
```

GraphQL playground: http://localhost:4350/graphql

## What This Indexes

- **All Uniswap V2 trading pairs** (discovered automatically)
- **All swaps** with amounts and participants
- **All mints** (liquidity additions)
- **All burns** (liquidity removals)
- **Trading statistics** per pair

## Performance

- Indexes from Uniswap V2 factory deployment (block 10,000,835) to current
- Processes ~1,000 blocks/sec with stable performance
- Syncs 4+ million blocks in under 1 hour
- Captures millions of transactions and thousands of pairs efficiently

## How It Works

This indexer uses Subsquid's recommended factory pattern with runtime filtering for optimal performance:

1. **Pair Discovery**: Captures PairCreated events from the Uniswap V2 factory contract
2. **Runtime Filtering**: Uses a Set-based lookup to process only events from known pairs
3. **Batch Processing**: Two-pass approach within each batch ensures all pairs are discovered before processing their events

The key optimization is avoiding the download of millions of irrelevant events by filtering at the processor level, rather than downloading everything and discarding 99% of it. This reduces sync time from 80+ hours to under a few hours.

-We turned O(n) into O(2n) = O(n) LOL. If you have a more optimal solution lmk.
-This was actually O(n^2) LOL.
-Found the more optimal solution. [Factory Pattern.](https://docs.sqd.ai/sdk/resources/evm/factory-contracts/)
Two-pass batch processing factory pattern from SQD worked.