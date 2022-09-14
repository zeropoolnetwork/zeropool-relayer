import { TxType } from 'zp-memo-parser'
import BN from 'bn.js'
import type { TxPayload } from '../queue/poolTxQueue';
import type { Pool } from '../pool';

export type MessageEvent = { data: string, transactionHash: string }

export enum TxStatus {
  Mined,
  Missing,
  Error,
}

export interface Chain {
  init(): Promise<void>;
  getNewEvents(): Promise<MessageEvent[]>;
  getContractTransferNum(): Promise<string>; // TODO: Return bigint?
  getContractMerkleRoot(index: string | number | undefined | null): Promise<string>;
  signAndSend(txConfig: any): Promise<string>;
  getDenominator(): Promise<string>;
  getTxStatus(txId: any): Promise<{ status: TxStatus, blockId?: any }>;
  parseCalldata(tx: string): PoolCalldata;
  processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string, commitIndex: number }>;
}

export class PoolCalldata {
  constructor(data: Object) {
    Object.assign(this, data)
  }

  nullifier!: BN
  outCommit!: BN
  transferIndex!: BN
  energyAmount!: BN
  tokenAmount!: BN
  delta!: BN
  transactProof!: BN[]
  rootAfter!: BN
  treeProof!: BN[]
  txType!: number
  memo!: Uint8Array
  depositAddress!: string
}
