import { BlockHeader } from "@subsquid/evm-processor"

export class BlockMap<T> {
  private data = new Map<number, T[]>()

  push(block: BlockHeader, item: T) {
    let items = this.data.get(block.height)
    if (!items) {
      items = []
      this.data.set(block.height, items)
    }
    items.push(item)
  }

  *[Symbol.iterator](): Iterator<[BlockHeader, T[]]> {
    for (const [height, items] of this.data) {
      // Create a minimal block header for iteration
      const block: BlockHeader = {
        id: height.toString(),
        height,
        timestamp: 0, // Will be set properly in actual usage
        hash: '',
        parentHash: ''
      }
      yield [block, items]
    }
  }

  get size(): number {
    return this.data.size
  }

  clear() {
    this.data.clear()
  }
}
