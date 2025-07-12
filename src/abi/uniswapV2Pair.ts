import * as p from '@subsquid/evm-codec'
import {event, fun, indexed, ContractBase} from '@subsquid/evm-abi'

export const events = {
    Swap: event("0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822", "Swap(address,uint256,uint256,uint256,uint256,address)", {
        sender: indexed(p.address),
        amount0In: p.uint256,
        amount1In: p.uint256,
        amount0Out: p.uint256,
        amount1Out: p.uint256,
        to: indexed(p.address),
    }),
    Mint: event("0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f", "Mint(address,uint256,uint256)", {
        sender: indexed(p.address),
        amount0: p.uint256,
        amount1: p.uint256,
    }),
    Burn: event("0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496", "Burn(address,uint256,uint256,address)", {
        sender: indexed(p.address),
        amount0: p.uint256,
        amount1: p.uint256,
        to: indexed(p.address),
    }),
    Sync: event("0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1", "Sync(uint112,uint112)", {
        reserve0: p.uint112,
        reserve1: p.uint112,
    }),
}

export const functions = {
    getReserves: fun("0x0902f1ac", "getReserves()", {}, {
        reserve0: p.uint112,
        reserve1: p.uint112,
        blockTimestampLast: p.uint32,
    }),
    token0: fun("0x0dfe1681", "token0()", {}, p.address),
    token1: fun("0xd21220a7", "token1()", {}, p.address),
    totalSupply: fun("0x18160ddd", "totalSupply()", {}, p.uint256),
    balanceOf: fun("0x70a08231", "balanceOf(address)", {owner: p.address}, p.uint256),
}

export class Contract extends ContractBase {

    getReserves() {
        return this.eth_call(functions.getReserves, {})
    }

    token0() {
        return this.eth_call(functions.token0, {})
    }

    token1() {
        return this.eth_call(functions.token1, {})
    }

    totalSupply() {
        return this.eth_call(functions.totalSupply, {})
    }

    balanceOf(owner: string) {
        return this.eth_call(functions.balanceOf, {owner})
    }
}
