# Uniswap V2 Squid

A Uniswap V2 indexer built with [Subsquid](https://www.sqd.ai/).

## What It Does

This indexer provides **complete Uniswap V2 analytics** with:

- **Real-time ETH pricing** from stablecoin pairs (DAI/WETH, USDC/WETH)
- **Accurate USD values** for all swaps, mints, burns, and liquidity
- **Complete transaction history**
- **Factory-level aggregates** (total volume, liquidity, pair count)
- **Production-grade data quality**

## How To Run

**Prerequisites:** Node.js 18+, Docker, Git

```bash
# Clone and setup
git clone https://github.com/gavinwale/uniswap-v2-squid
cd uniswap-v2-squid
cp .env.example .env
npm install
npm i -g @subsquid/cli


# Start database
sqd up

# Build and migrate
sqd codegen
sqd build
sqd migration:generate
sqd migration:apply

# Start indexing
sqd process

# Start GraphQL API (in another terminal)
sqd serve
```

**GraphQL Playground:** http://localhost:4350/graphql

## Example Queries

### Get ETH Price and Top Pairs
```graphql
query TopPairs {
  bundles { ethPrice }
  pairs(orderBy: volumeUSD_DESC, limit: 5) {
    id
    volumeUSD
    reserveUSD
    token0 { symbol }
    token1 { symbol }
  }
}
```

### Recent Swaps with USD Values
```graphql
query RecentSwaps {
  swaps(orderBy: timestamp_DESC, limit: 10) {
    amountUSD
    timestamp
    pair {
      token0 { symbol }
      token1 { symbol }
    }
  }
}
```

## Architecture

### Clean, Single-File Processing
All mapping logic consolidated into `src/mappings/processor.ts` for:
- Event extraction and sorting
- Pair discovery and creation
- Real-time pricing
- USD value computation
- Entity persistence

### Smart Pricing Engine
1. **ETH Price Discovery:** Uses highest-liquidity stablecoin pair
2. **Token Pricing:** Calculates derivedETH from WETH pairs
3. **USD Calculations:** Real-time conversion with overflow protection
4. **Data Validation:** Filters out scam tokens and extreme values (adjustable)

## Why This Matters

**For DeFi Analytics:** Get accurate historical and real-time Uniswap V2 data

**For Trading Apps:** Power volume, liquidity, and price feeds

**For Research:** Complete transaction-level data with proper USD valuations

**For Dashboards:** GraphQL API with all major metrics

## What's Indexed

| Entity | Description |
|--------|-------------|
| Pairs | All Uniswap V2 trading pairs |
| Swaps | Token exchanges with USD values |
| Mints | Liquidity additions |
| Burns | Liquidity removals |
| Tokens | All tokens with pricing data |

## Configuration

**Current Scope:** This indexer only processes **500,000 blocks** (from Uniswap V2 deployment) for demonstration purposes.

### Extending the Indexer

**Adjust Block Range:** Edit `src/config.ts` lines 32-34:
```typescript
.setBlockRange({
    from: 10000835, // Uniswap V2 Factory deployment
    to: 10500835,   // Change this to process more blocks
})
```

**Add More Chains:**
- See: https://docs.sqd.ai/sdk/resources/multichain/

**RPC Configuration:** An RPC endpoint is configured (`https://rpc.ankr.com/eth`) but currently only used for finality confirmation. You can:

- **Use Your Own RPC:** Edit `src/config.ts` line 16:
  ```typescript
  .setRpcEndpoint('https://your-rpc-endpoint.com')
  ```

- **Add Token Metadata Calls:** Currently uses hardcoded info for major tokens (WETH, DAI, USDC, USDT) and contract addresses for others. You can extend the `createToken()` function in `src/mappings/processor.ts` to make RPC calls for real token metadata (name, symbol, decimals).

- **More RPC Features:** See https://docs.sqd.ai/


