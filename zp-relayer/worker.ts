import BN from 'bn.js'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import { api } from './services/polkadot'
import { logger } from './services/appLogger'
import { redis } from './services/redisClient'
import { TxPayload } from './services/jobQueue'
import { TX_QUEUE_NAME, OUTPLUSONE, TRANSFER_INDEX_SIZE, ENERGY_SIZE, TOKEN_SIZE } from './utils/constants'
import { readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { numToHex, flattenProof, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { Helpers, Proof, SnarkProof } from 'libzeropool-rs-node'
import { pool } from './pool'
import { getTxData, TxType } from 'zp-memo-parser'
import { config } from './config/config'

const {
  RELAYER_ADDRESS_PRIVATE_KEY,
  GAS_PRICE,
} = process.env as Record<PropertyKey, string>

const ZERO = toBN(0)

interface Delta {
  transferIndex: BN
  energyAmount: BN
  tokenAmount: BN
  poolId: BN
}

function checkCommitment(treeProof: Proof, txProof: Proof) {
  return treeProof.inputs[2] === txProof.inputs[2]
}

function checkTxProof(txProof: Proof) {
  return pool.verifyProof(txProof.proof, txProof.inputs)
}

async function checkNullifier(nullifier: string) {
  const res = await api.query.zeropool.nullifiers(nullifier)
  // No idea what the type here is supposed to be
  // @ts-ignore
  return res.isSome
}

function checkTransferIndex(contractPoolIndex: BN, transferIndex: BN) {
  return transferIndex.lte(contractPoolIndex)
}

function checkTxSpecificFields(txType: TxType, tokenAmount: BN, energyAmount: BN, nativeAmount: BN | null, msgValue: BN) {
  logger.debug(`TOKENS ${tokenAmount.toString()}, ENERGY ${energyAmount.toString()}, MEMO NATIVE ${nativeAmount?.toString()}, MSG VALUE ${msgValue.toString()}`)
  let isValid = false
  if (txType === TxType.DEPOSIT) {
    isValid =
      tokenAmount.gte(ZERO) &&
      energyAmount.eq(ZERO) &&
      msgValue.eq(ZERO)
  } else if (txType === TxType.TRANSFER) {
    isValid =
      tokenAmount.eq(ZERO) &&
      energyAmount.eq(ZERO) &&
      msgValue.eq(ZERO)
  } else if (txType === TxType.WITHDRAWAL) {
    isValid =
      tokenAmount.lte(ZERO) &&
      energyAmount.lte(ZERO)
    if (nativeAmount)
      isValid = isValid && msgValue.eq(nativeAmount.mul(pool.denominator))
  }
  return isValid
}


function parseDelta(delta: string): Delta {
  const { poolId, index, e, v } = Helpers.parseDelta(delta)
  return {
    transferIndex: toBN(index),
    energyAmount: toBN(e),
    tokenAmount: toBN(v),
    poolId: toBN(poolId),
  }
}

function checkFeeAndNativeAmount(fee: BN, nativeAmount: BN | null) {
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

async function checkAssertion(f: Function, errStr: string) {
  const res = await f()
  if (!res) {
    logger.error(errStr)
    throw new Error(errStr)
  }
}

function buildTxData(
  txProof: SnarkProof,
  treeProof: SnarkProof,
  nullifier: string,
  outCommit: string,
  delta: Delta,
  rootAfter: string,
  txType: TxType,
  memo: string,
  depositSignature: string | null
) {

  const selector: string = '0x00000000'

  const transferIndex = numToHex(delta.transferIndex, TRANSFER_INDEX_SIZE)
  const energyAmount = numToHex(delta.energyAmount, ENERGY_SIZE)
  const tokenAmount = numToHex(delta.tokenAmount, TOKEN_SIZE)
  logger.debug(`DELTA ${transferIndex} ${energyAmount} ${tokenAmount}`)

  const txFlatProof = flattenProof(txProof)
  const treeFlatProof = flattenProof(treeProof)

  const memoMessage = memo
  const memoSize = numToHex(toBN(memoMessage.length).divn(2), 4)

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

  await pool.syncState()

  logger.info(`${logPrefix} Recieved ${txType} tx with ${amount} native amount`)

  await checkAssertion(
    () => checkNullifier(txProof.inputs[1]),
    `${logPrefix} Doublespend detected`
  )

  const buf = Buffer.from(rawMemo, 'hex')
  const { fee, nativeAmount } = getTxData(buf, txType)

  await checkAssertion(
    () => checkFeeAndNativeAmount(fee, nativeAmount),
    `${logPrefix} Fee too low`
  )

  await checkAssertion(
    () => checkTxProof(txProof),
    `${logPrefix} Incorrect transfer proof`
  )

  const contractTransferIndex = Number(await readTransferNum())
  const delta = parseDelta(txProof.inputs[3])

  await checkAssertion(
    () => checkTransferIndex(toBN(contractTransferIndex), delta.transferIndex),
    `${logPrefix} Incorrect transfer index`
  )

  await checkAssertion(
    () => checkTxSpecificFields(
      txType,
      delta.tokenAmount,
      delta.energyAmount,
      nativeAmount,
      toBN(amount)
    ),
    `${logPrefix} Tx specific fields are incorrect`
  )

  const outCommit = txProof.inputs[2]
  const {
    proof: treeProof,
    nextCommitIndex
  } = pool.getVirtualTreeProof(outCommit, contractTransferIndex)

  await checkAssertion(
    () => checkCommitment(treeProof, txProof),
    `${logPrefix} Commmitment mismatch`
  )

  const data = buildTxData(
    txProof.proof,
    treeProof.proof,
    numToHex(toBN(txProof.inputs[1])),
    numToHex(toBN(treeProof.inputs[2])),
    delta,
    numToHex(toBN(treeProof.inputs[1])),
    txType,
    rawMemo,
    depositSignature
  )

  const txHash = await signAndSend(
    data,
    api
  )
  logger.debug(`${logPrefix} TX hash ${txHash}`)

  await updateField(RelayerKeys.TRANSFER_NUM, contractTransferIndex + OUTPLUSONE)

  const truncatedMemo = truncateMemoTxPrefix(rawMemo, txType)
  const commitAndMemo = numToHex(toBN(outCommit)).concat(truncatedMemo)

  logger.debug(`${logPrefix} Updating tree`)
  pool.addCommitment(nextCommitIndex, Helpers.strToNum(outCommit))

  logger.debug(`${logPrefix} Adding tx to storage`)
  pool.txs.add(contractTransferIndex, Buffer.from(commitAndMemo, 'hex'))

  return txHash
}


export async function createTxWorker() {
  await pool.init()

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
