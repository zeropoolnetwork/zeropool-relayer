import Contract from 'web3-eth-contract'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { logger } from './services/appLogger'
import { TxPayload } from './queue/poolTxQueue'
import { TRANSFER_INDEX_SIZE, ENERGY_SIZE, TOKEN_SIZE } from './utils/constants'
import { numToHex, flattenProof, truncateHexPrefix } from './utils/helpers'
import { SnarkProof, Proof } from 'libzeropool-rs-node'
import { TxType } from 'zp-memo-parser'
import type { Pool } from './pool'

import { Delta, parseDelta } from './validateTx'

// @ts-ignore
const PoolInstance = new Contract(PoolAbi as AbiItem[])

interface TxData {
  txProof: SnarkProof
  treeProof: SnarkProof
  nullifier: string
  outCommit: string
  rootAfter: string
  delta: Delta
  txType: TxType
  memo: string
  extraData: string | null
}

function buildTxData(txData: TxData) {
  const selector: string = PoolInstance.methods.transact().encodeABI()

  const transferIndex = numToHex(txData.delta.transferIndex, TRANSFER_INDEX_SIZE)
  const energyAmount = numToHex(txData.delta.energyAmount, ENERGY_SIZE)
  const tokenAmount = numToHex(txData.delta.tokenAmount, TOKEN_SIZE)
  logger.debug(`DELTA ${transferIndex} ${energyAmount} ${tokenAmount}`)

  const txFlatProof = flattenProof(txData.txProof)
  const treeFlatProof = flattenProof(txData.treeProof)

  const memoMessage = txData.memo
  const memoSize = numToHex(toBN(memoMessage.length).divn(2), 4)

  const data = [
    selector,
    txData.nullifier,
    txData.outCommit,
    transferIndex,
    energyAmount,
    tokenAmount,
    txFlatProof,
    txData.rootAfter,
    treeFlatProof,
    txData.txType,
    memoSize,
    memoMessage,
  ]

  if (txData.extraData) {
    const extraData = truncateHexPrefix(txData.extraData)
    data.push(extraData)
  }

  return data.join('')
}

export async function processTx(id: string, tx: TxPayload, pool: Pool) {
  const { amount, txProof, txType, rawMemo, extraData } = tx

  const logPrefix = `Job ${id}:`

  logger.info(`${logPrefix} Recieved ${txType} tx with ${amount} native amount`)

  let delta: Delta
  if (txType == TxType.DELEGATED_DEPOSIT) {
    delta = {
      transferIndex: toBN(0),
      energyAmount: toBN(0),
      tokenAmount: toBN(0),
      poolId: toBN(0),
    }
  } else {
    delta = parseDelta(txProof.inputs[3])
  }

  let nullifier
  if (txType == TxType.DELEGATED_DEPOSIT) {
    nullifier = toBN(0)
  } else {
    nullifier = toBN(txProof.inputs[1])
  }

  let outCommit
  if (txType == TxType.DELEGATED_DEPOSIT) {
    outCommit = tx.delegatedDeposit!.secret.out_commitment_hash
  } else {
    outCommit = txProof.inputs[2]
  }
  const { pub, sec, commitIndex } = pool.optimisticState.getVirtualTreeProofInputs(outCommit)

  logger.debug(`${logPrefix} Proving tree...`)
  const treeProof = await Proof.treeAsync(pool.treeParams, pub, sec)
  logger.debug(`${logPrefix} Tree proved`)

  const data = buildTxData({
    txProof: txProof.proof,
    treeProof: treeProof.proof,
    nullifier: numToHex(nullifier),
    outCommit: numToHex(toBN(outCommit)),
    rootAfter: numToHex(toBN(treeProof.inputs[1])),
    delta,
    txType,
    memo: rawMemo,
    extraData,
  })
  return { data, commitIndex }
}
