import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class Swap {
    constructor(props?: Partial<Swap>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    pair!: string

    @Index_()
    @StringColumn_({nullable: false})
    sender!: string

    @BigIntColumn_({nullable: false})
    amount0In!: bigint

    @BigIntColumn_({nullable: false})
    amount1In!: bigint

    @BigIntColumn_({nullable: false})
    amount0Out!: bigint

    @BigIntColumn_({nullable: false})
    amount1Out!: bigint

    @Index_()
    @StringColumn_({nullable: false})
    to!: string

    @IntColumn_({nullable: false})
    block!: number

    @StringColumn_({nullable: false})
    txHash!: string

    @DateTimeColumn_({nullable: false})
    timestamp!: Date
}
