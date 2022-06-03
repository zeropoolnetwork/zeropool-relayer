import { toBN } from 'web3-utils'
import { Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { TxPayload } from './services/poolTxQueue'
import { TX_QUEUE_NAME, OUTPLUSONE, MAX_SENT_LIMIT, TX_CHECK_DELAY } from './utils/constants'
import { readNonce, updateField, RelayerKeys, incrNonce } from './utils/redisFields'
import { numToHex, truncateMemoTxPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { pool } from './pool'
import { sentTxQueue } from './services/sentTxQueue'
import { processTx } from './txProcessor'
import { toWei } from 'web3-utils'
import { config } from './config/config'
import { redis } from './services/redisClient'

const {
  RELAYER_ADDRESS_PRIVATE_KEY,
  GAS_PRICE,
} = process.env as Record<PropertyKey, string>

export async function createPoolTxWorker() {
  await updateField(RelayerKeys.NONCE, await readNonce(true))
  const poolTxWorker = new Worker<TxPayload>(TX_QUEUE_NAME, async job => {
    const logPrefix = `POOL WORKER: Job ${job.id}:`
    logger.info('%s processing...', logPrefix)

    const { data, commitIndex } = await processTx(job, pool)
    const { gas, amount, rawMemo, txType, txProof } = job.data
    const outCommit = txProof.inputs[2]

    const nonce = await incrNonce()
    logger.info(`${logPrefix} nonce: ${nonce}`)
    
    let txHash: string
    try {
      txHash = await signAndSend(
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
    } catch (e) {
      logger.error(`${logPrefix} Send TX failed: ${e}`)
      throw e
    }

    logger.debug(`${logPrefix} TX hash ${txHash}`)

    await updateField(RelayerKeys.TRANSFER_NUM, commitIndex * OUTPLUSONE)

    const truncatedMemo = truncateMemoTxPrefix(rawMemo, txType)
    const txData = numToHex(toBN(outCommit))
      .concat(txHash.slice(2))
      .concat(truncatedMemo)

    pool.optimisticState.updateState(commitIndex, outCommit, txData)

    await sentTxQueue.add(txHash, {
      payload: job.data,
      outCommit,
      commitIndex,
      txHash,
      txData,
      txConfig: {}
    },
      {
        delay: TX_CHECK_DELAY
      })

    const sentTxNum = await sentTxQueue.count()
    if (sentTxNum > MAX_SENT_LIMIT) {
      await poolTxWorker.pause()
    }

    return txHash
  }, {
    autorun: false,
    connection: redis,
    concurrency: 1,
  })

  return poolTxWorker
}