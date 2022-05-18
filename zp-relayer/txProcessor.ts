import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Job, Worker } from 'bullmq'
import Contract from 'web3-eth-contract'
import { logger } from './services/appLogger'
import { redis } from './services/redisClient'
import { TxPayload } from './services/poolTxQueue'
import { TRANSFER_INDEX_SIZE, ENERGY_SIZE, TOKEN_SIZE, } from './utils/constants'
import { readNonce, readTransferNum, updateField, RelayerKeys } from './utils/redisFields'
import { numToHex, flattenProof, truncateHexPrefix } from './utils/helpers'
import { SnarkProof } from 'libzeropool-rs-node'
import { pool } from './pool'
import { TxType } from 'zp-memo-parser'

import {
  Delta,
  parseDelta,
} from './validation'

// @ts-ignore
const PoolInstance = new Contract(PoolAbi as AbiItem[])

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

  const selector: string = PoolInstance.methods.transact().encodeABI()

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

export async function processTx(job: Job<TxPayload>) {
  const {
    amount,
    txProof,
    txType,
    rawMemo,
    depositSignature,
  } = job.data
  const jobId = job.id

  const logPrefix = `Job ${jobId}:`

  await pool.syncState()

  logger.info(`${logPrefix} Recieved ${txType} tx with ${amount} native amount`)

  const contractTransferIndex = Number(await readTransferNum())
  const delta = parseDelta(txProof.inputs[3])

  const outCommit = txProof.inputs[2]
  const {
    pub,
    sec,
    nextCommitIndex
  } = pool.optimisticState.getVirtualTreeProofInputs(outCommit, contractTransferIndex)

  const treeProof = await pool.getTreeProof(pub, sec)

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
  return { data, nextCommitIndex }
}