import { AbiItem, toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { TxPayload, poolTxQueue } from './services/poolTxQueue'
import { TX_QUEUE_NAME, OUTPLUSONE, TRANSFER_INDEX_SIZE, ENERGY_SIZE, TOKEN_SIZE, MAX_SENT_LIMIT, TX_CHECK_DELAY } from './utils/constants'
import { readNonce, readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { numToHex, flattenProof, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { Helpers, SnarkProof } from 'libzeropool-rs-node'
import { pool } from './pool'
import {
  parseDelta,
} from './validation'
import { SentTxPayload } from './services/sentTxQueue'
import { sentTxQueue } from './services/sentTxQueue'
import { processTx } from './txProcessor'
import { toWei } from 'web3-utils'


const {
  RELAYER_ADDRESS_PRIVATE_KEY,
  GAS_PRICE,
} = process.env as Record<PropertyKey, string>

const token = 'RELAYER'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createPoolTxWorker() {
  // Reset nonce
  await updateField(RelayerKeys.NONCE, await readNonce(true))
  await updateField(RelayerKeys.TRANSFER_NUM, await readTransferNum(true))

  await pool.init()

  const poolTxQueueWorker = new Worker<TxPayload>(TX_QUEUE_NAME)

  while (true) {
    await sleep(500)
    const sentTxNum = await sentTxQueue.count()
    if (sentTxNum > MAX_SENT_LIMIT) continue

    const job: Job<TxPayload> | undefined = await poolTxQueueWorker.getNextJob(token)
    
    if (!job) continue

    const logPrefix = `POOL WORKER: Job ${job.id}:`
    logger.info('%s: processing...', logPrefix)

    const { data, nextCommitIndex } = await processTx(job)
    const nonce = Number(await readNonce())
    const { gas, to, amount, rawMemo, txType, txProof } = job.data
    const outCommit = txProof.inputs[2]

    const txHash = await signAndSend(
      {
        data,
        nonce,
        gasPrice: GAS_PRICE,
        value: toWei(toBN(amount)),
        gas,
        to,
        chainId: pool.chainId,
      },
      RELAYER_ADDRESS_PRIVATE_KEY,
      web3
    )
    logger.debug(`${logPrefix} TX hash ${txHash}`)
  
    const contractTransferIndex = Number()

    await updateField(RelayerKeys.NONCE, nonce + 1)
    await updateField(RelayerKeys.TRANSFER_NUM, contractTransferIndex + OUTPLUSONE)
  
    const truncatedMemo = truncateMemoTxPrefix(rawMemo, txType)
    const commitAndMemo = numToHex(toBN(outCommit)).concat(txHash.slice(2)).concat(truncatedMemo)
  
    logger.debug(`${logPrefix} Updating tree`)
    pool.state.addCommitment(nextCommitIndex, Helpers.strToNum(outCommit))
  
    logger.debug(`${logPrefix} Adding tx to storage`)
    pool.optimisticState.addTx(contractTransferIndex, Buffer.from(commitAndMemo, 'hex'))

    await sentTxQueue.add(txHash, {
      payload: job.data,
      txHash,
      txConfig: {}
    },
    {
      delay: TX_CHECK_DELAY
    })
  }
}
