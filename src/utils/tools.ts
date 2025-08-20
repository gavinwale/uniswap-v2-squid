export function convertTokenToDecimal(tokenAmount: bigint, decimals: bigint): number {
  if (decimals === 0n) {
    return Number(tokenAmount)
  }
  return Number(tokenAmount) / Math.pow(10, Number(decimals))
}
