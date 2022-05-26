import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'
import { SENT_TX_QUEUE_NAME } from './utils/constants'
import { readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { Helpers } from 'libzkbob-rs-node'
import { pool } from './pool'
import { SentTxPayload } from './services/sentTxQueue'
import { RelayerWorker } from './relayerWorker'
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

export class SentTxWorker extends RelayerWorker<SentTxPayload> {
  constructor() {
    const sentTxQueueWorker = new Worker<SentTxPayload>(SENT_TX_QUEUE_NAME, undefined, {
      connection: redis
    })
    super('sent-tx', 500, sentTxQueueWorker)
  }

  async init() {
    await updateField(RelayerKeys.TRANSFER_NUM, await readTransferNum(true))
  }

  async checkPreconditions(): Promise<boolean> {
    return true
  }

  async run(job: Job<SentTxPayload>) {
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

        return txHash
      } else { // Revert
        logger.debug('%s Transaction %s reverted at block %s', logPrefix, txHash, tx.blockNumber)
        const failTxs = await collectBatch(this.internalWorker, MAX_SENT_LIMIT + 1)
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
