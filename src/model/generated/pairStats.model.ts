import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class PairStats {
    constructor(props?: Partial<PairStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @IntColumn_({nullable: false})
    totalSwaps!: number

    @IntColumn_({nullable: false})
    totalMints!: number

    @IntColumn_({nullable: false})
    totalBurns!: number

    @DateTimeColumn_({nullable: false})
    lastActivity!: Date

    @DateTimeColumn_({nullable: false})
    firstActivity!: Date

    @BigIntColumn_({nullable: false})
    totalVolumeToken0!: bigint

    @BigIntColumn_({nullable: false})
    totalVolumeToken1!: bigint
}
