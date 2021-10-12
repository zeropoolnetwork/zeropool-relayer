import { Queue } from 'bullmq'
import { redis } from './redisClient'
import { TX_QUEUE_NAME } from '../utils/constants'
import { TxType } from '../utils/helpers'
import { Proof } from 'libzeropool-rs-node'

export interface TxPayload {
  to: string
  amount: string
  gas: string | number
  txProof: Proof
  txType: TxType
  rawMemo: string
  depositSignature: string | null
}
export const txQueue = new Queue<TxPayload, string>(TX_QUEUE_NAME, {
  connection: redis
})

