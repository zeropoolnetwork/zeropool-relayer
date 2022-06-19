import { Queue, QueueScheduler } from 'bullmq'
import { redis } from './redisClient'
import { SENT_TX_QUEUE_NAME } from '../utils/constants'
import { TxPayload } from './poolTxQueue'
import type { TransactionConfig} from 'web3-core'


export interface SentTxPayload {
  payload: TxPayload
  outCommit: string
  commitIndex: number
  txHash: string
  txData: string
  txConfig: TransactionConfig
}

// Required for delayed jobs processing
const sentTxQueueScheduler = new QueueScheduler(SENT_TX_QUEUE_NAME, {
  connection: redis,
})

export const sentTxQueue = new Queue<SentTxPayload, string>(SENT_TX_QUEUE_NAME, {
  connection: redis,
})
