import * as p from '@subsquid/evm-codec'
import {event, fun, indexed, ContractBase} from '@subsquid/evm-abi'

export const events = {
    PairCreated: event("0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9", "PairCreated(address,address,address,uint256)", {
        token0: indexed(p.address),
        token1: indexed(p.address),
        pair: p.address,
        allPairsLength: p.uint256,
    }),
}

export const functions = {
    allPairs: fun("0x1e3dd18b", "allPairs(uint256)", {_0: p.uint256}, p.address),
    allPairsLength: fun("0x574f2ba3", "allPairsLength()", {}, p.uint256),
    createPair: fun("0xc9c65396", "createPair(address,address)", {tokenA: p.address, tokenB: p.address}, p.address),
    feeTo: fun("0x017e7e58", "feeTo()", {}, p.address),
    feeToSetter: fun("0x094b7415", "feeToSetter()", {}, p.address),
    getPair: fun("0xe6a43905", "getPair(address,address)", {_0: p.address, _1: p.address}, p.address),
}

export class Contract extends ContractBase {

    allPairs(_0: bigint): Promise<string> {
        return this.eth_call(functions.allPairs, {_0})
    }

    allPairsLength(): Promise<bigint> {
        return this.eth_call(functions.allPairsLength, {})
    }

    feeTo(): Promise<string> {
        return this.eth_call(functions.feeTo, {})
    }

    feeToSetter(): Promise<string> {
        return this.eth_call(functions.feeToSetter, {})
    }

    getPair(token0: string, token1: string): Promise<string> {
        return this.eth_call(functions.getPair, {_0: token0, _1: token1})
    }
}
