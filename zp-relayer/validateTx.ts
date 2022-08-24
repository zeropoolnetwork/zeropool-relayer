import BN from 'bn.js'
import { toBN, AbiItem } from 'web3-utils'
import { TxType, TxData, WithdrawTxData, PermittableDepositTxData, getTxData } from 'zp-memo-parser'
import { Helpers, Proof } from 'libzkbob-rs-node'
import { logger } from './services/appLogger'
import config from './config'
import { pool, PoolTx } from './pool'
import { NullifierSet } from './nullifierSet'
import TokenAbi from './abi/token-abi.json'
import { web3 } from './services/web3'
import { numToHex, unpackSignature } from './utils/helpers'
import { recoverSaltedPermit } from './utils/EIP712SaltedPermit'

const tokenContract = new web3.eth.Contract(TokenAbi as AbiItem[], config.tokenAddress)

const ZERO = toBN(0)

export interface Delta {
  transferIndex: BN
  energyAmount: BN
  tokenAmount: BN
  poolId: BN
}

export function checkSize(data: string, size: number) {
  return data.length === size
}

export async function checkBalance(address: string, minBalance: string) {
  const balance = await tokenContract.methods.balanceOf(address).call()
  return toBN(balance).gte(toBN(minBalance))
}

export function checkCommitment(treeProof: Proof, txProof: Proof) {
  return treeProof.inputs[2] === txProof.inputs[2]
}

export function checkTxProof(txProof: Proof) {
  return pool.verifyProof(txProof.proof, txProof.inputs)
}

export async function checkNullifier(nullifier: string, nullifierSet: NullifierSet) {
  const inSet = await nullifierSet.isInSet(nullifier)
  return inSet === 0
}

export function checkTransferIndex(contractPoolIndex: BN, transferIndex: BN) {
  return transferIndex.lte(contractPoolIndex)
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
    logger.error('Assertion error: %s', errStr)
    throw new Error(errStr)
  }
}

async function checkDepositEnoughBalance(
  txType: TxType,
  tokenAmount: BN,
  depositSignature: string | null,
  txData: TxData,
  proofNullifier: string
) {
  if (!(txType === TxType.DEPOSIT || txType === TxType.PERMITTABLE_DEPOSIT)) {
    return true
  }

  // Signature without `0x` prefix, size is 64*2=128
  await checkAssertion(() => depositSignature !== null && checkSize(depositSignature, 128), 'Invalid deposit signature')
  const nullifier = '0x' + numToHex(toBN(proofNullifier))
  const sig = unpackSignature(depositSignature as string)

  let recoveredAddress: string
  if (txType === TxType.DEPOSIT) {
    recoveredAddress = web3.eth.accounts.recover(nullifier, sig)
  } else {
    const { deadline, holder } = txData as PermittableDepositTxData
    const owner = new TextDecoder().decode(holder)
    const nonce = await tokenContract.methods.nonces(owner).call()

    recoveredAddress = recoverSaltedPermit(
      {
        owner,
        spender: config.poolAddress as string,
        value: tokenAmount.toString(10),
        nonce,
        deadline: deadline.toString(10),
        salt: nullifier,
      },
      sig
    )

    await checkAssertion(() => checkDeadline(deadline), `Deadline is expired`)
  }

  const requiredTokenAmount = tokenAmount.mul(pool.denominator)
  return checkBalance(recoveredAddress, requiredTokenAmount.toString(10))
}

export async function validateTx({ txType, proof, memo, depositSignature }: PoolTx) {
  const buf = Buffer.from(memo, 'hex')
  const txData = getTxData(buf, txType)

  await checkAssertion(() => checkFee(txData.fee), `Fee too low`)

  if (txType === TxType.WITHDRAWAL) {
    const nativeAmount = (txData as WithdrawTxData).nativeAmount
    await checkAssertion(() => checkNativeAmount(nativeAmount), `Native amount too high`)
  }

  if (txType === TxType.PERMITTABLE_DEPOSIT) {
  }

  await checkAssertion(() => checkTxProof(proof), `Incorrect transfer proof`)

  const delta = parseDelta(proof.inputs[3])

  const tokenAmountWithFee = delta.tokenAmount.add(txData.fee)
  await checkAssertion(
    () => checkTxSpecificFields(txType, tokenAmountWithFee, delta.energyAmount, txData, toBN('0')),
    `Tx specific fields are incorrect`
  )

  await checkAssertion(
    () => checkDepositEnoughBalance(txType, tokenAmountWithFee, depositSignature, txData, proof.inputs[1]),
    'Not enough balance for deposit'
  )
}
