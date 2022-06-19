import { Job, Queue, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'
import { SENT_TX_QUEUE_NAME } from './utils/constants'
import { RelayerKeys, updateField, readNonce } from './utils/redisFields'
import { pool } from './pool'
import { SentTxPayload, sentTxQueue } from './services/sentTxQueue'
import { redis } from './services/redisClient'

const token = 'RELAYER'
const MAX_SENT_LIMIT = 10

const WORKER_OPTIONS = {
  autorun: false,
  connection: redis,
  concurrency: 1,
}

async function collectBatch<T>(queue: Queue<T>) {
  const jobs = await queue.getJobs(['delayed', 'waiting'])

  await Promise.all(jobs.map(async j => {
    // TODO fix "Missing lock for job" error
    await j.moveToFailed({
      message: 'rescheduled',
      name: 'RescheduledError'
    }, token)
  }))

  return jobs
}

export async function createSentTxWorker() {
  const sentTxWorker = new Worker<SentTxPayload>(SENT_TX_QUEUE_NAME, async job => {
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
        logger.error('%s Transaction %s reverted at block %s', logPrefix, txHash, tx.blockNumber)
        const failTxs = await collectBatch(sentTxQueue)
        logger.info('Moving all sent jobs to tx queue...')
        for (const failTxJob of failTxs) {
          const newJob = await poolTxQueue.add('tx', failTxJob.data.payload)
          logger.debug('%s Moved job %s to main queue: %s', logPrefix, failTxJob.id, newJob.id)
        }

        logger.info('Rollback optimistic state...')
        pool.optimisticState.rollbackTo(pool.state)
        const root1 = pool.state.getMerkleRoot()
        const root2 = pool.optimisticState.getMerkleRoot()
        logger.info(`Assert roots are equal: ${root1}, ${root2}, ${root1 === root2}`)
      }
    } else { // Not mined
      logger.error('Unsupported')
      // TODO:
      // Maybe increase gasPrice and need to reschedule all other queue jobs
      // to maintain correct ordering
    }
  }, WORKER_OPTIONS)
  return sentTxWorker
}