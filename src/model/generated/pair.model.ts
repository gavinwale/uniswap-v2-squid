import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class Pair {
    constructor(props?: Partial<Pair>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    token0!: string

    @Index_()
    @StringColumn_({nullable: false})
    token1!: string

    @Index_()
    @StringColumn_({nullable: false})
    pairAddress!: string

    @IntColumn_({nullable: false})
    block!: number

    @StringColumn_({nullable: false})
    txHash!: string

    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @BigIntColumn_({nullable: false})
    allPairsLength!: bigint
}
