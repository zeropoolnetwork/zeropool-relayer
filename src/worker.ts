import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { redis } from './services/redisClient'
import { TxPayload } from './services/jobQueue'
import { getNonce } from './utils/web3'
import { decodeMemo } from './utils/memo'
import { TX_QUEUE_NAME } from './utils/constants'
import { TxType, numToHex, flattenProof, truncateHexPrefix } from './utils/helpers'
import { signAndSend } from './tx/signAndSend'
import { config } from './config/config'
import { Helpers, Proof } from 'libzeropool-rs-node'
import { pool } from './pool'

const nonceKey = `relayer:nonce`
const transferNumKey = `relayer:transferNum`

const {
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>

async function readNonce(forceUpdate?: boolean) {
  logger.debug('Reading nonce')
  if (forceUpdate) {
    logger.debug('Forcing update of nonce')
    return await getNonce(web3, config.relayerAddress)
  }

  const nonce = await redis.get(nonceKey)
  if (nonce) {
    logger.debug(`Nonce found in the DB ${nonce} `)
    return Number(nonce)
  } else {
    logger.warn(`Nonce wasn't found in the DB`)
    return getNonce(web3, config.relayerAddress)
  }
}

function updateNonce(nonce: number) {
  return redis.set(nonceKey, nonce)
}

async function readTransferNum(forceUpdate?: boolean) {
  const getTransferNum = () => pool.PoolInstance.methods.transfer_num().call()

  logger.debug('Reading transferNum')
  if (forceUpdate) {
    logger.debug('Forcing update of transferNum')
    return getTransferNum()
  }

  const num = await redis.get(transferNumKey)
  if (num) {
    logger.debug(`TransferNum found in the DB ${num}`)
    return Number(num)
  } else {
    logger.warn(`Nonce wasn't found in the DB`)
    return getTransferNum()
  }
}

function updateTransferNum(num: number) {
  return redis.set(transferNumKey, num)
}

const PoolInstance = new web3.eth.Contract(PoolAbi as AbiItem[], config.poolAddress)

function buildTxData(txProof: Proof, treeProof: Proof, txType: TxType, memo: string, depositSignature: string | null) {
  const selector: string = PoolInstance.methods.transact().encodeABI()

  const nullifier = numToHex(txProof.inputs[1])
  const out_commit = numToHex(treeProof.inputs[2])

  if (treeProof.inputs[2] !== txProof.inputs[2]) {
    throw new Error('commmitment error')
  }

  const delta = Helpers.parseDelta(txProof.inputs[3])
  const transfer_index = numToHex(delta.index, 12)
  const enery_amount = numToHex(delta.e, 16)
  const token_amount = numToHex(delta.v, 16)

  const transact_proof = flattenProof(txProof.proof)

  const root_after = numToHex(treeProof.inputs[1])
  const tree_proof = flattenProof(treeProof.proof)

  const tx_type = txType
  const memo_message = memo
  const memo_size = numToHex((memo_message.length / 2).toString(), 4)

  const data = [
    selector,
    nullifier,
    out_commit,
    transfer_index,
    enery_amount,
    token_amount,
    transact_proof,
    root_after,
    tree_proof,
    tx_type,
    memo_size,
    memo_message
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
    depositSignature
  } = job.data
  const jobId = job.id

  const logPrefix = `Job ${jobId}:`

  const verifyRes = pool.verifyProof(txProof.proof, txProof.inputs)

  if (!verifyRes) {
    logger.error(`${logPrefix} proof verification failed`)
    throw new Error('Incorrect transfer proof')
  }

  const memo = decodeMemo(Buffer.from(rawMemo, 'hex'), txType)

  const hashes = [memo.accHash].concat(memo.noteHashes)

  const { proof: treeProof, transferNum } = pool.getVirtualTreeProof(hashes)

  const data = buildTxData(
    txProof,
    treeProof,
    txType,
    rawMemo,
    depositSignature
  )

  const nonce = await readNonce()
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

  await updateNonce(nonce + 1)
  await updateTransferNum(transferNum)

  logger.debug(`${logPrefix} Updating tree`)
  pool.appendHashes(hashes)

  logger.debug(`${logPrefix} Adding tx to storage`)
  // 16 + 16 + 40
  let txSpecificPrefixLen = txType === TxType.WITHDRAWAL ? 72 : 16
  const truncatedMemo = rawMemo.slice(txSpecificPrefixLen)
  const commitAndMemo = numToHex(treeProof.inputs[2]).concat(truncatedMemo)
  pool.txs.add(transferNum, Buffer.from(commitAndMemo, 'hex'))

  return txHash
}


export function createTxWorker() {
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

  return worker
}
