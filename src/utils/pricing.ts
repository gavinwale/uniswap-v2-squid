export const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

export const WHITELIST_TOKENS: string[] = [
  WETH_ADDRESS, // WETH
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
]

export const STABLE_COINS: string[] = [
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
]

export function getTrackedVolumeUSD(
  token0: string,
  amount0USD: number,
  token1: string,
  amount1USD: number
): number {

  const t0 = token0.toLowerCase()
  const t1 = token1.toLowerCase()
  const whitelist = WHITELIST_TOKENS.map(t => t.toLowerCase())

  if (whitelist.includes(t0) && whitelist.includes(t1)) {
    return (amount0USD + amount1USD) / 2
  }

  if (whitelist.includes(t0) && !whitelist.includes(t1)) {
    return amount0USD
  }

  if (!whitelist.includes(t0) && whitelist.includes(t1)) {
    return amount1USD
  }

  return 0
}

export function getTrackedLiquidityUSD(
  tokenAmount0: number,
  token0: string,
  tokenAmount1: number,
  token1: string,
  bundle: { ethPriceUSD: number },
  token0DerivedETH: number,
  token1DerivedETH: number
): number {
  const t0 = token0.toLowerCase()
  const t1 = token1.toLowerCase()
  const whitelist = WHITELIST_TOKENS.map(t => t.toLowerCase())

  const price0USD = token0DerivedETH * bundle.ethPriceUSD
  const price1USD = token1DerivedETH * bundle.ethPriceUSD

  if (whitelist.includes(t0) && whitelist.includes(t1)) {
    return tokenAmount0 * price0USD + tokenAmount1 * price1USD
  }

  if (whitelist.includes(t0) && !whitelist.includes(t1)) {
    return tokenAmount0 * price0USD * 2
  }

  if (!whitelist.includes(t0) && whitelist.includes(t1)) {
    return tokenAmount1 * price1USD * 2
  }

  return 0
}


