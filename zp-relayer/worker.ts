import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { redis } from './services/redisClient'
import { TxPayload } from './services/jobQueue'
import { TX_QUEUE_NAME, OUTPLUSONE } from './utils/constants'
import { readNonce, readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { TxType, numToHex, flattenProof, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { Helpers, Proof } from 'libzeropool-rs-node'
import { pool } from './pool'
import { getTxData } from 'zp-memo-parser'
import { config } from './config/config'

const PoolInstance = new web3.eth.Contract(PoolAbi as AbiItem[])

const {
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>


function parseDelta(delta: string) {
  const { index, e, v } = Helpers.parseDelta(delta)
  return {
    transferIndex: numToHex(index, 12),
    energyAmount: numToHex(e, 16),
    tokenAmount: numToHex(v, 16),
  }
}

function checkCommitment(treeProof: Proof, txProof: Proof) {
  return treeProof.inputs[2] === txProof.inputs[2]
}

function checkTxProof(txProof: Proof) {
  return pool.verifyProof(txProof.proof, txProof.inputs)
}

function checkFeeAndNativeAmount(memo: string, txType: TxType) {
  const buf = Buffer.from(memo, 'hex')
  const { fee, nativeAmount } = getTxData(buf, txType)
  logger.debug(`Fee: ${fee}`)
  logger.debug(`Native amount: ${nativeAmount}`)
  // Check native amount (relayer faucet)
  if (nativeAmount && nativeAmount > config.maxFaucet) {
    return false
  }
  // Check user fee
  if (fee < config.relayerFee) {
    return false
  }
  return true
}

function checkAssertion(f: Function, errStr: string) {
  if (!f()) {
    logger.error(errStr)
    throw new Error(errStr)
  }
}

function buildTxData(txProof: Proof, treeProof: Proof, txType: TxType, memo: string, depositSignature: string | null) {

  const selector: string = PoolInstance.methods.transact().encodeABI()

  const nullifier = numToHex(txProof.inputs[1])
  const outCommit = numToHex(treeProof.inputs[2])

  const {
    transferIndex,
    energyAmount,
    tokenAmount
  } = parseDelta(txProof.inputs[3])
  logger.debug(`DELTA ${transferIndex} ${energyAmount} ${tokenAmount}`)

  const txFlatProof = flattenProof(txProof.proof)

  const rootAfter = numToHex(treeProof.inputs[1])
  const treeFlatProof = flattenProof(treeProof.proof)

  const memoMessage = memo
  const memoSize = numToHex((memoMessage.length / 2).toString(), 4)

  const data = [
    selector,
    nullifier,
    outCommit,
    transferIndex,
    energyAmount,
    tokenAmount,
    txFlatProof,
    rootAfter,
    treeFlatProof,
    txType,
    memoSize,
    memoMessage
  ]

  if (depositSignature) {
    depositSignature = truncateHexPrefix(depositSignature)
    data.push(depositSignature)
  }

  return data.join('')
}

async function processTx(job: Job<TxPayload>) {
  const {
    to,
    amount,
    gas,
    txProof,
    txType,
    rawMemo,
    depositSignature,
  } = job.data
  const jobId = job.id

  const logPrefix = `Job ${jobId}:`

  checkAssertion(
    () => checkFeeAndNativeAmount(rawMemo, txType),
    `${logPrefix} Fee too low`
  )

  checkAssertion(
    () => checkTxProof(txProof),
    `${logPrefix} Incorrect transfer proof`
  )

  const outCommit = txProof.inputs[2]
  const transferNum = Number(await readTransferNum())
  const {
    proof: treeProof,
    nextCommitIndex
  } = pool.getVirtualTreeProof(outCommit, transferNum)

  checkAssertion(
    () => checkCommitment(treeProof, txProof),
    `${logPrefix} Commmitment mismatch`
  )

  const data = buildTxData(
    txProof,
    treeProof,
    txType,
    rawMemo,
    depositSignature
  )

  const nonce = Number(await readNonce())
  const txHash = await signAndSend(
    RELAYER_ADDRESS_PRIVATE_KEY,
    data,
    nonce,
    // TODO gasPrice
    '',
    toBN(amount),
    // TODO gas
    gas,
    to,
    await web3.eth.getChainId(),
    web3
  )
  logger.debug(`${logPrefix} TX hash ${txHash}`)

  await updateField(RelayerKeys.NONCE, nonce + 1)
  await updateField(RelayerKeys.TRANSFER_NUM, transferNum + OUTPLUSONE)

  const truncatedMemo = truncateMemoTxPrefix(rawMemo, txType)
  const commitAndMemo = numToHex(outCommit).concat(truncatedMemo)

  logger.debug(`${logPrefix} Updating tree`)
  pool.addCommitment(nextCommitIndex, Helpers.strToNum(outCommit))

  logger.debug(`${logPrefix} Adding tx to storage`)
  pool.txs.add(transferNum, Buffer.from(commitAndMemo, 'hex'))

  return txHash
}


export async function createTxWorker() {
  // Reset nonce
  const nonce = Number(await readNonce(true))
  await updateField(RelayerKeys.NONCE, nonce + 1)

  const worker = new Worker<TxPayload>(
    TX_QUEUE_NAME,
    job => {
      logger.info(`Processing job ${job.id}...`)
      return processTx(job)
    },
    {
      connection: redis
    }
  )
  logger.info(`Worker ${worker.name}`)

  return worker
}
