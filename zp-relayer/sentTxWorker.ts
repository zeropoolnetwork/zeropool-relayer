import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'
import { SENT_TX_QUEUE_NAME } from './utils/constants'
import { pool } from './pool'
import { SentTxPayload } from './services/sentTxQueue'
import { redis } from './services/redisClient'

const token = 'RELAYER'
const MAX_SENT_LIMIT = 10

async function collectBatch<T>(worker: Worker<T>, maxSize: number) {
  const jobs: Job<T>[] = []
  for (let i = 0; i < maxSize; i++) {
    const job = await worker.getNextJob(token);
    if (job) jobs.push(job)
    else return jobs
  }
  return jobs
}

export const sentTxWorker = new Worker<SentTxPayload>(SENT_TX_QUEUE_NAME, async job => {
  const logPrefix = `SENT WORKER: Job ${job.id}:`
  logger.info('%s processing...', logPrefix)

  const {
    txHash,
    txData,
    commitIndex,
    outCommit,
    payload
  } = job.data

  const tx = await web3.eth.getTransactionReceipt(txHash)
  if (tx) { // Tx mined
    if (tx.status) { // Successful
      logger.debug('%s Transaction %s was successfully mined at block %s', logPrefix, txHash, tx.blockNumber)

      pool.state.updateState(commitIndex, outCommit, txData)

      const node1 = pool.state.getCommitment(commitIndex)
      const node2 = pool.optimisticState.getCommitment(commitIndex)
      logger.info(`Assert nodes are equal: ${node1}, ${node2}, ${node1 === node2}`)

      return txHash
    } else { // Revert
      logger.debug('%s Transaction %s reverted at block %s', logPrefix, txHash, tx.blockNumber)
      const failTxs = await collectBatch(sentTxWorker, MAX_SENT_LIMIT + 1)
      for (const failTxJob of failTxs) {
        const newJob = await poolTxQueue.add('tx', failTxJob.data.payload)
        logger.debug('%s Moved job %s to main queue: %s', logPrefix, failTxJob.id, newJob.id)
      }
    }
  } else { // Not mined
    logger.error('Unsupported')
  }
}, {
  autorun: false,
  connection: redis
})
