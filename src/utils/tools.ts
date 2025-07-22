export function splitIntoBatches<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize))
  }
  return batches
}

export function last<T>(array: T[]): T {
  return array[array.length - 1]
}

export function removeNullBytes(value: string): string {
  return value.replace(/\0/g, '')
}

export function convertTokenToDecimal(tokenAmount: bigint, decimals: bigint): number {
  if (decimals === 0n) {
    return Number(tokenAmount)
  }
  return Number(tokenAmount) / Math.pow(10, Number(decimals))
}

export function addressToBytes(address: string): Uint8Array {
  const hex = address.startsWith('0x') ? address.slice(2) : address
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

export const ZERO_BD = 0
export const ONE_BD = 1
