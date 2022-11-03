import { TxType } from 'zp-memo-parser'
import BN from 'bn.js'
import type { TxPayload } from '../queue/poolTxQueue'
import type { Pool, PoolTx } from '../pool'

export type MessageEvent = { data: string, transactionHash: string }

export enum TxStatus {
  Mined,
  Missing,
  Error,
}

export abstract class Chain {
  public denominator: BN = new BN(1)

  abstract getLatestBlockId(): Promise<number>

  abstract getContractTransferNum(): Promise<string> // TODO: Return bigint?
  abstract getContractMerkleRoot(index: string | number | undefined | null): Promise<string>

  abstract signAndSend(txConfig: any): Promise<string>

  abstract getTxStatus(txId: any): Promise<{ status: TxStatus, blockId?: any }>

  abstract parseCalldata(tx: string): PoolCalldata

  abstract processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string, commitIndex: number }>

  abstract toBaseUnit(amount: BN): BN

  abstract fromBaseUnit(amount: BN): BN

  toDenominatedAmount(amount: BN): BN {
    return amount.div(this.denominator)
  }

  fromDenominatedAmount(amount: BN): BN {
    return amount.mul(this.denominator)
  }

  async validateTx(tx: PoolTx): Promise<void> {
  }

  prepareTxForStorage(outCommit: BN, hash: string, truncatedMemo: string): string {
    throw new Error('Not implemented')
  }

  abstract extractCiphertextFromTx(memo: string, txType: TxType): string
}


export class PoolCalldata {
  constructor(data: Object) {
    Object.assign(this, data)
  }

  nullifier!: BN
  outCommit!: BN
  tokenId!: string
  delta!: BN
  transactProof!: BN[]
  rootAfter!: BN
  treeProof!: BN[]
  txType!: number
  memo!: Buffer
  extraData?: Buffer
}
