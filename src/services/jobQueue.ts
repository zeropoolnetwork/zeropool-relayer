import { Queue } from 'bullmq'
import { redis } from './redisClient'
import { TX_QUEUE_NAME } from '../utils/constants'

interface TxPayload {
  to: string
  data: string
  amount: string | number
  gas: string | number
  hashes: Buffer[]
}

export const txQueue = new Queue<TxPayload>(TX_QUEUE_NAME, {
  connection: redis
})

