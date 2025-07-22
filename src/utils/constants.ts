// Uniswap V2 Factory address
export const FACTORY_ADDRESS = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'

// Uniswap V2 Factory deployment block
export const FACTORY_DEPLOYED_AT = 10000835

export const TOKEN_DECIMALS: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
}

export const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
}

export const TOKEN_NAMES: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'Wrapped Ether',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'Dai Stablecoin',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USD Coin',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'Tether USD',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'Wrapped BTC',
}


