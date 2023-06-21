import { toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import type { Mutex } from 'async-mutex'

import { web3 } from '../services/web3'
import { logger } from '../services/appLogger'
import { TX_QUEUE_NAME, OUTPLUSONE, MAX_SENT_LIMIT } from '../utils/constants'
import { readNonce, updateField, RelayerKeys, incrNonce } from '../utils/redisFields'
import { numToHex, withMutex } from '../utils/helpers'
import { pool } from '../pool'
import { redis } from '../services/redisClient'
import { checkNullifier, checkTransferIndex, parseDelta } from '../validateTx'
import { checkAssertion } from '../utils/helpers'
import type { EstimationType, GasPrice } from '../services/GasPrice'
import { getChainId } from '../utils/web3'
import { TxPayload } from '../queue/poolTxQueue'
import bs58 from 'bs58';
import { TxStatus } from '../chains/chain'

const WORKER_OPTIONS = {
  autorun: false,
  connection: redis,
  concurrency: 1,
}

export async function createPoolTxWorker<T extends EstimationType>(mutex: Mutex, gasPrice: GasPrice<T> | null) {
  const poolTxWorkerProcessor = async (job: Job<TxPayload[]>) => {
    const txs = job.data

    const logPrefix = `POOL WORKER: Job ${job.id}:`
    logger.info('%s processing...', logPrefix)
    logger.info('%s Recieved %s txs', logPrefix, txs.length)

    const txHashes: string[] = []
    for (const tx of txs) {
      const { gas, amount, rawMemo, txType, txProof, extraData } = tx

      const nullifier = txProof.inputs[1]
      const outCommit = txProof.inputs[2]
      const delta = parseDelta(txProof.inputs[3])

      await checkAssertion(() => checkNullifier(nullifier, pool.state.nullifiers))
      await checkAssertion(() => checkNullifier(nullifier, pool.optimisticState.nullifiers))
      await checkAssertion(() => checkTransferIndex(toBN(pool.optimisticState.getNextIndex()), delta.transferIndex))

      const { data, commitIndex } = await pool.chain.processTx(job.id as string, tx, pool)

      const nonce = await incrNonce()
      logger.info(`%s ${logPrefix} nonce: ${nonce}`, logPrefix)

      try {
        logger.info('%s Updating optimistic state', logPrefix)
        const truncatedMemo = pool.chain.extractCiphertextFromTx(rawMemo, txType)
        let txData = numToHex(toBN(outCommit)).concat('0'.repeat(64)).concat(truncatedMemo)
        pool.optimisticState.updateState(commitIndex, outCommit, txData)
        await updateField(RelayerKeys.TRANSFER_NUM, commitIndex * OUTPLUSONE)
        await pool.optimisticState.nullifiers.add([nullifier])

        logger.info('%s Sending TX', logPrefix)
        const txHash = await pool.chain.signAndSend({ data, nonce, gas, amount })
        logger.debug(`%s TX hash ${txHash}`, logPrefix)
        txHashes.push(txHash)

        const hexTxHash = Buffer.from(bs58.decode(txHash)).toString('hex')
        txData = numToHex(toBN(outCommit)).concat(hexTxHash).concat(truncatedMemo)
        pool.optimisticState.updateState(commitIndex, outCommit, txData)

        // Check the transaction ================================================================================
        const MAX_ATTEMPTS = 10
        let attempts = 0
        while (true) {
          logger.info('%s Attempt %d to get transaction status', logPrefix, attempts + 1)
          const tx = await pool.chain.getTxStatus(txHash)

          if (tx.status == TxStatus.Mined) {
            // Successful
            logger.debug('%s Transaction %s was successfully mined at block %s', logPrefix, txHash, tx.blockId)

            const chainTx = await pool.chain.getTx(txHash)
            pool.txCache.add(chainTx)

            const hexTxHash = Buffer.from(bs58.decode(txHash)).toString('hex')
            // update txData with new txHash
            const newTxData = txData.slice(0, 64) + hexTxHash + txData.slice(128)

            pool.state.updateState(commitIndex, outCommit, newTxData)

            // Add nullifer to confirmed state and remove from optimistic one
            logger.info('%s Adding nullifier %s to PS', logPrefix, nullifier)
            await pool.state.nullifiers.add([nullifier])
            logger.info('%s Removing nullifier %s from OS', logPrefix, nullifier)
            await pool.optimisticState.nullifiers.remove([nullifier])

            const node1 = pool.state.getCommitment(commitIndex)
            const node2 = pool.optimisticState.getCommitment(commitIndex)
            logger.info(`%s Assert commitments are equal: ${node1}, ${node2}`, logPrefix)
            if (node1 !== node2) {
              logger.error('%s Commitments are not equal', logPrefix)
            }

            return txHash
          } else if (tx.status == TxStatus.FatalError || tx.status == TxStatus.RecoverableError || attempts == MAX_ATTEMPTS) {
            if (tx.status == TxStatus.RecoverableError) {
              logger.warn('%s Transaction %s is in recoverable error state', logPrefix, txHash)
              logger.warn('%s !!! Recovery unimplemented, reverting optimistic state', logPrefix)
            }

            logger.error('%s Transaction %s failed with error: %s', logPrefix, txHash, tx.error)

            logger.info('%s Rollback optimistic state...', logPrefix)
            pool.optimisticState.rollbackTo(pool.state)
            await pool.optimisticState.nullifiers.clear()
            const root1 = pool.state.getMerkleRoot()
            const root2 = pool.optimisticState.getMerkleRoot()
            logger.debug(`%s Assert roots are equal: ${root1}, ${root2}, ${root1 === root2}`, logPrefix)

            return null
          }

          logger.info('%s Transaction %s is not mined yet, retrying...', logPrefix, txHash)
          attempts++
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      } catch (e) {
        logger.error(`${logPrefix} Send TX failed: ${e}`)
        throw e
      }
    }

    return txHashes
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
