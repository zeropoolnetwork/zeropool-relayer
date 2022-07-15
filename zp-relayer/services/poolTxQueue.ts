import { Queue } from 'bullmq'
import { redis } from './redisClient'
import { TX_QUEUE_NAME } from '../utils/constants'
import { Proof } from 'libzkbob-rs-node'
import { TxType } from 'zp-memo-parser'
import { Delta } from '../validation'

export interface TxPayload {
  amount: string
  gas: string | number
  txProof: Proof
  delta: Delta
  txType: TxType
  rawMemo: string
  depositSignature: string | null
}
export const poolTxQueue = new Queue<TxPayload, string>(TX_QUEUE_NAME, {
  connection: redis
})
