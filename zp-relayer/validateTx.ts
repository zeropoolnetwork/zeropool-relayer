import BN from 'bn.js'
import { TxType, TxData, WithdrawTxData, PermittableDepositTxData, getTxData } from 'zp-memo-parser'
import { Helpers, Proof } from 'libzkbob-rs-node'
import { logger } from './services/appLogger'
import config from './config'
import { NullifierSet } from './nullifierSet'

import { pool, PoolTx } from './pool';
import { toBN } from 'web3-utils';
const ZERO = new BN(0)

export interface Delta {
  transferIndex: BN
  energyAmount: BN
  tokenAmount: BN
  poolId: BN
}

export function checkSize(data: string, size: number) {
  return data.length === size
}

export function checkCommitment(treeProof: Proof, txProof: Proof) {
  return treeProof.inputs[2] === txProof.inputs[2]
}

export function checkTxProof(txProof: Proof) {
  const res = pool.verifyProof(txProof.proof, txProof.inputs)
  if (!res) {
    return new Error('Incorrect transfer proof')
  }
  return null
}

export async function checkNullifier(nullifier: string, nullifierSet: NullifierSet) {
  const inSet = await nullifierSet.isInSet(nullifier)
  if (inSet === 0) return null
  return new Error(`Doublespend detected in ${nullifierSet.name}`)
}

export function checkTransferIndex(contractPoolIndex: BN, transferIndex: BN) {
  if (transferIndex.lte(contractPoolIndex)) return null
  return new Error(`Incorrect transfer index`)
}

export function checkTxSpecificFields(txType: TxType, tokenAmount: BN, energyAmount: BN, txData: TxData, msgValue: BN) {
  logger.debug(
    'TOKENS %s, ENERGY %s, TX DATA %s, MSG VALUE %s',
    tokenAmount.toString(),
    energyAmount.toString(),
    JSON.stringify(txData),
    msgValue.toString()
  )
  let isValid = false
  if (txType === TxType.DEPOSIT || txType === TxType.PERMITTABLE_DEPOSIT) {
    isValid = tokenAmount.gte(ZERO) && energyAmount.eq(ZERO) && msgValue.eq(ZERO)
  } else if (txType === TxType.TRANSFER) {
    isValid = tokenAmount.eq(ZERO) && energyAmount.eq(ZERO) && msgValue.eq(ZERO)
  } else if (txType === TxType.WITHDRAWAL) {
    const nativeAmount = (txData as WithdrawTxData).nativeAmount
    isValid = tokenAmount.lte(ZERO) && energyAmount.lte(ZERO)
    isValid = isValid && msgValue.eq(nativeAmount.mul(pool.denominator))
  }
  if (!isValid) {
    return new Error('Tx specific fields are incorrect')
  }
  return null
}

export function checkNativeAmount(nativeAmount: BN | null) {
  logger.debug(`Native amount: ${nativeAmount}`)
  // Check native amount (relayer faucet)
  if (nativeAmount && nativeAmount > config.maxFaucet) {
    return new Error('Native amount too high')
  }
  return null
}

export function checkFee(fee: BN) {
  logger.debug(`Fee: ${fee}`)
  if (fee.lt(config.relayerFee)) {
    return new Error('Fee too low')
  }
  return null
}

export function checkDeadline(deadline: BN) {
  logger.debug(`Deadline: ${deadline}`)
  // Check native amount (relayer faucet)
  const currentTimestamp = new BN(Math.floor(Date.now() / 1000))
  if (deadline <= currentTimestamp) {
    return new Error(`Deadline is expired`)
  }
  return null
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