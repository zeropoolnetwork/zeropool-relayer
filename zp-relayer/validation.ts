import BN from 'bn.js'
import { toBN } from 'web3-utils'
import { TxType, TxData, WithdrawTxData, PermittableDepositTxData, getTxData } from 'zp-memo-parser'
import { Helpers, Proof } from 'libzkbob-rs-node'
import { logger } from './services/appLogger'
import { config } from './config/config'
import { pool } from './pool'

const ZERO = toBN(0)

export interface Delta {
  transferIndex: BN
  energyAmount: BN
  tokenAmount: BN
  poolId: BN
}

export function checkCommitment(treeProof: Proof, txProof: Proof) {
  return treeProof.inputs[2] === txProof.inputs[2]
}

export function checkTxProof(txProof: Proof) {
  return pool.verifyProof(txProof.proof, txProof.inputs)
}

export async function checkNullifier(nullifier: string) {
  const exists = await pool.PoolInstance.methods.nullifiers(nullifier).call()
  return toBN(exists).eq(ZERO)
}

export function checkTransferIndex(contractPoolIndex: BN, transferIndex: BN) {
  return transferIndex.lte(contractPoolIndex)
}

export function checkTxSpecificFields(txType: TxType, tokenAmount: BN, energyAmount: BN, txData: TxData, msgValue: BN) {
  logger.debug('TOKENS %s, ENERGY %s, TX DATA %s, MSG VALUE %s',
    tokenAmount.toString(),
    energyAmount.toString(),
    JSON.stringify(txData),
    msgValue.toString()
  )
  let isValid = false
  if (txType === TxType.DEPOSIT || txType === TxType.PERMITTABLE_DEPOSIT) {
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
    const nativeAmount = (txData as WithdrawTxData).nativeAmount
    isValid =
      tokenAmount.lte(ZERO) &&
      energyAmount.lte(ZERO)
    isValid = isValid && msgValue.eq(nativeAmount.mul(pool.denominator))
  }
  return isValid
}

export function parseDelta(delta: string): Delta {
  const { poolId, index, e, v } = Helpers.parseDelta(delta)
  return {
    transferIndex: toBN(index),
    energyAmount: toBN(e),
    tokenAmount: toBN(v),
    poolId: toBN(poolId),
  }
}

export function checkNativeAmount(nativeAmount: BN | null) {
  logger.debug(`Native amount: ${nativeAmount}`)
  // Check native amount (relayer faucet)
  if (nativeAmount && nativeAmount > config.maxFaucet) {
    return false
  }
  return true
}

export function checkFee(fee: BN) {
  logger.debug(`Fee: ${fee}`)
  return fee >= config.relayerFee
}

export function checkDeadline(deadline: BN) {
  logger.debug(`Deadline: ${deadline}`)
  // Check native amount (relayer faucet)
  const currentTimestamp = new BN(Math.floor(Date.now() / 1000))
  if (deadline <= currentTimestamp) {
    return false
  }
  return true
}

export async function checkAssertion(f: Function, errStr: string) {
  const res = await f()
  if (!res) {
    logger.error(errStr)
    throw new Error(errStr)
  }
}

interface ValidateTx {
  txType: TxType
  txProof: Proof
  rawMemo: string
}

export async function validateTx(
  { txType, txProof, rawMemo }: ValidateTx,
  maxPoolIndex: number
) {
  await checkAssertion(
    () => checkNullifier(txProof.inputs[1]),
    `Doublespend detected`
  )

  const buf = Buffer.from(rawMemo, 'hex')
  const txData = getTxData(buf, txType)

  await checkAssertion(
    () => checkFee(txData.fee),
    `Fee too low`
  )

  if (txType === TxType.WITHDRAWAL) {
    const nativeAmount = (txData as WithdrawTxData).nativeAmount
    await checkAssertion(
      () => checkNativeAmount(nativeAmount),
      `Native amount too high`
    )
  }

  if (txType === TxType.PERMITTABLE_DEPOSIT) {
    const deadline = (txData as PermittableDepositTxData).deadline
    await checkAssertion(
      () => checkDeadline(deadline),
      `Deadline is expired`
    )
  }

  await checkAssertion(
    () => checkTxProof(txProof),
    `Incorrect transfer proof`
  )

  const delta = parseDelta(txProof.inputs[3])

  await checkAssertion(
    () => checkTransferIndex(toBN(maxPoolIndex), delta.transferIndex),
    `Incorrect transfer index`
  )

  await checkAssertion(
    () => checkTxSpecificFields(
      txType,
      delta.tokenAmount,
      delta.energyAmount,
      txData,
      toBN('0')
    ),
    `Tx specific fields are incorrect`
  )
}