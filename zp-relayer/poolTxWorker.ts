import { toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { TxPayload } from './services/poolTxQueue'
import { TX_QUEUE_NAME, OUTPLUSONE, TRANSFER_INDEX_SIZE, ENERGY_SIZE, TOKEN_SIZE, MAX_SENT_LIMIT, TX_CHECK_DELAY } from './utils/constants'
import { readNonce, readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { numToHex, truncateMemoTxPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { Helpers } from 'libzeropool-rs-node'
import { pool } from './pool'
import { sentTxQueue } from './services/sentTxQueue'
import { processTx } from './txProcessor'
import { toWei } from 'web3-utils'
import { config } from './config/config'
import { RelayerWorker } from './relayerWorker'
import { redis } from './services/redisClient'

const {
  RELAYER_ADDRESS_PRIVATE_KEY,
  GAS_PRICE,
} = process.env as Record<PropertyKey, string>

const token = 'RELAYER'

export class PoolTxWorker extends RelayerWorker {
  constructor() {
    const poolTxQueueWorker = new Worker<TxPayload>(TX_QUEUE_NAME, undefined, {
      connection: redis
    })
    super('pool-tx', 500, poolTxQueueWorker)
  }

  async init() {
    await updateField(RelayerKeys.NONCE, await readNonce(true))
    await updateField(RelayerKeys.TRANSFER_NUM, await readTransferNum(true))

    await pool.init()
  }

  async run() {
    const sentTxNum = await sentTxQueue.count()
    if (sentTxNum > MAX_SENT_LIMIT) return

    const job: Job<TxPayload> | undefined = await this.internalWorker.getNextJob(token)

    if (!job) return

    const logPrefix = `POOL WORKER: Job ${job.id}:`
    logger.info('%s processing...', logPrefix)

    const { data, commitIndex } = await processTx(job, pool)
    const { gas, amount, rawMemo, txType, txProof } = job.data
    const outCommit = txProof.inputs[2]

    const nonce = Number(await readNonce())
    const txHash = await signAndSend(
      {
        data,
        nonce,
        gasPrice: GAS_PRICE,
        value: toWei(toBN(amount)),
        gas,
        to: config.poolAddress,
        chainId: pool.chainId,
      },
      RELAYER_ADDRESS_PRIVATE_KEY,
      web3
    )
    logger.debug(`${logPrefix} TX hash ${txHash}`)

    await updateField(RelayerKeys.NONCE, nonce + 1)
    await updateField(RelayerKeys.TRANSFER_NUM, commitIndex * OUTPLUSONE)

    const truncatedMemo = truncateMemoTxPrefix(rawMemo, txType)
    const txData = numToHex(toBN(outCommit))
      .concat(txHash.slice(2))
      .concat(truncatedMemo)

    logger.debug(`${logPrefix} Updating optimistic tree`)
    pool.optimisticState.addCommitment(commitIndex, Helpers.strToNum(outCommit))

    logger.debug(`${logPrefix} Adding tx to storage`)
    pool.optimisticState.addTx(commitIndex * OUTPLUSONE, Buffer.from(txData, 'hex'))

    await sentTxQueue.add(txHash, {
      payload: job.data,
      outCommit,
      commitIndex,
      txHash,
      txConfig: {}
    },
      {
        delay: TX_CHECK_DELAY
      })

    await job.moveToCompleted('processed', token)
  }
}
