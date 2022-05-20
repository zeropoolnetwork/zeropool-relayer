import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'
import { SENT_TX_QUEUE_NAME } from './utils/constants'
import { readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { Helpers } from 'libzeropool-rs-node'
import { pool } from './pool'
import { SentTxPayload } from './services/sentTxQueue'

const token = 'RELAYER'
const MAX_SENT_LIMIT = 10

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectBatch<T>(worker: Worker<T>, maxSize: number) {
  const jobs: Job<T>[] = []
  for (let i = 0; i < maxSize; i++) {
    const job = await worker.getNextJob(token);
    if (job) jobs.push(job)
    else return jobs
  }
  return jobs
}

export async function createSentTxWorker() {
  // Reset nonce
  // await readNonce(true)
  await updateField(RelayerKeys.TRANSFER_NUM, await readTransferNum(true))

  await pool.init()

  const sentTxQueueWorker = new Worker<SentTxPayload>(SENT_TX_QUEUE_NAME)

  while (true) {
    await sleep(500)

    const job: Job<SentTxPayload> | undefined = await sentTxQueueWorker.getNextJob(token)

    if (!job) continue

    const logPrefix = `SENT WORKER: Job ${job.id}:`
    logger.info('%s processing...', logPrefix)

    const {
      txHash,
      commitIndex,
      outCommit,
      payload
    } = job.data

    const tx = await web3.eth.getTransactionReceipt(txHash)
    if (tx) { // Tx mined
      if (tx.status) { // Successful
        logger.debug('%s Transaction %s was successfully mined at block %s', logPrefix, txHash, tx.blockNumber)

        pool.state.addCommitment(commitIndex, Helpers.strToNum(outCommit))
        const node1 = pool.state.getCommitment(commitIndex)
        const node2 = pool.optimisticState.getCommitment(commitIndex)
        logger.info(`Assert nodes are equal: ${node1}, ${node2}, ${node1 === node2}`)

      } else { // Revert
        logger.debug('%s Transaction %s reverted at block %s', logPrefix, txHash, tx.blockNumber)
        const failTxs = await collectBatch(sentTxQueueWorker, MAX_SENT_LIMIT + 1)
        for (const failTxJob of failTxs) {
          const newJob = await poolTxQueue.add('tx', failTxJob.data.payload)
          logger.debug('%s Moved job %s to main queue: %s', logPrefix, failTxJob.id, newJob.id)
        }
      }
    } else { // Not mined
      logger.error('Unsupported')
    }
  }
}
