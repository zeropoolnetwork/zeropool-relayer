import { AbiItem, toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { redis } from './services/redisClient'
import { TxPayload, poolTxQueue } from './services/poolTxQueue'
import { TX_QUEUE_NAME, OUTPLUSONE, TRANSFER_INDEX_SIZE, ENERGY_SIZE, TOKEN_SIZE, SENT_TX_QUEUE_NAME } from './utils/constants'
import { readNonce, readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { numToHex, flattenProof, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { Helpers, SnarkProof } from 'libzeropool-rs-node'
import { pool } from './pool'
import {
  parseDelta,
} from './validation'
import { SentTxPayload } from './services/sentTxQueue'
import { Queue, QueueScheduler } from 'bullmq'


const {
  RELAYER_ADDRESS_PRIVATE_KEY,
  GAS_PRICE,
} = process.env as Record<PropertyKey, string>

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

  const sentTxQueueWorker = new Worker<SentTxPayload>(SENT_TX_QUEUE_NAME, async (job) => {
    logger.info('AAAAAA %s', await job.isDelayed())
    console.log(job.opts)
    

    const logPrefix = `SENT WORKER: Job ${job.id}:`
    logger.info('%s processing...', logPrefix)

    const txHash = job.data.txHash

    const tx = await web3.eth.getTransactionReceipt(txHash)
    if (tx) { // Tx mined
      if (tx.status) { // Successful
        logger.debug('%s Transaction %s was successfully mined at block %s', logPrefix, txHash, tx.blockNumber)
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
  })
}
