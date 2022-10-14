import { toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import type { Mutex } from 'async-mutex'

import { web3 } from '../services/web3'
import { logger } from '../services/appLogger'
import { TX_QUEUE_NAME, OUTPLUSONE, MAX_SENT_LIMIT } from '../utils/constants'
import { readNonce, updateField, RelayerKeys, incrNonce } from '../utils/redisFields'
import { numToHex, truncateMemoTxPrefix, withMutex } from '../utils/helpers'
import { pool } from '../pool'
import config from '../config'
import { redis } from '../services/redisClient'
import { checkNullifier, checkTransferIndex, parseDelta } from '../validateTx'
import { checkAssertion } from '../utils/helpers'
import type { EstimationType, GasPrice } from '../services/GasPrice'
import { getChainId } from '../utils/web3'
import { TxPayload } from '../queue/poolTxQueue'
import { sentTxQueue } from '../queue/sentTxQueue';

const WORKER_OPTIONS = {
  autorun: false,
  connection: redis,
  concurrency: 1,
}

export async function createPoolTxWorker<T extends EstimationType>(mutex: Mutex, gasPrice: GasPrice<T> | null) {
  let chainId = 0
  // chainId is only relevant for EVM based chains
  if (config.chain == 'evm') {
    chainId = await getChainId(web3)
  }

  const poolTxWorkerProcessor = async (job: Job<TxPayload[]>) => {
    const txs = job.data

    const logPrefix = `POOL WORKER: Job ${job.id}:`
    logger.info('%s processing...', logPrefix)
    logger.info('Recieved %s txs', txs.length)

    const txHashes = []
    for (const tx of txs) {
      const { gas, amount, rawMemo, txType, txProof } = tx

      const nullifier = txProof.inputs[1]
      const outCommit = txProof.inputs[2]
      const delta = parseDelta(txProof.inputs[3])

      await checkAssertion(() => checkNullifier(nullifier, pool.state.nullifiers))
      await checkAssertion(() => checkNullifier(nullifier, pool.optimisticState.nullifiers))
      await checkAssertion(() => checkTransferIndex(toBN(pool.optimisticState.getNextIndex()), delta.transferIndex))

      const { data, commitIndex } = await pool.chain.processTx(job.id as string, tx, pool)

      const nonce = await incrNonce()
      logger.info(`${logPrefix} nonce: ${nonce}`)

      let gasPriceOptions = {}
      if (gasPrice) {
        gasPriceOptions = gasPrice.getPrice()
      }

      const txConfig = {
        data,
        nonce,
        value: pool.chain.toBaseUnit(toBN(amount)),
        gas,
        to: config.poolAddress,
        chainId: chainId,
        ...gasPriceOptions,
      }

      try {
        const txHash = await pool.chain.signAndSend({ data, nonce, gas, amount })
        logger.debug(`${logPrefix} TX hash ${txHash}`)

        await updateField(RelayerKeys.TRANSFER_NUM, commitIndex * OUTPLUSONE)

        const truncatedMemo = truncateMemoTxPrefix(rawMemo, txType)
        const txData = numToHex(toBN(outCommit)).concat(txHash.slice(2)).concat(truncatedMemo)

        pool.optimisticState.updateState(commitIndex, outCommit, txData)
        logger.info('Adding nullifier %s to OS', nullifier)
        await pool.optimisticState.nullifiers.add([nullifier])

        txHashes.push(txHash)

        await sentTxQueue.add(
          txHash,
          {
            payload: tx,
            outCommit,
            commitIndex,
            txHash,
            txData,
            nullifier,
            txConfig,
          },
          {
            delay: config.sentTxDelay,
            priority: nonce,
          }
        )

        const sentTxNum = await sentTxQueue.count()
        if (sentTxNum > MAX_SENT_LIMIT) {
          await poolTxWorker.pause()
        }
      } catch (e) {
        logger.error(`${logPrefix} Send TX failed: ${e}`)
        throw e
      }
    }

    return txHashes
  }

  if (config.chain !== 'near') {
    await updateField(RelayerKeys.NONCE, await readNonce(true))
  }

  const poolTxWorker = new Worker<TxPayload[]>(
    TX_QUEUE_NAME,
    job => withMutex(mutex, () => poolTxWorkerProcessor(job)),
    WORKER_OPTIONS
  )

  poolTxWorker.on('error', e => {
    logger.info('POOL_WORKER ERR: %o', e)
  })

  return poolTxWorker
}
