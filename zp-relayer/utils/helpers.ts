import BN from 'bn.js'
import { numberToHex, padLeft, toBN } from 'web3-utils'
import { logger } from '../services/appLogger'
import { SnarkProof } from 'libzkbob-rs-node'
import { TxType } from 'zp-memo-parser'

export function toTxType(t: string): TxType {
  t = truncateHexPrefix(t)
  if (
    t === TxType.DEPOSIT ||
    t === TxType.TRANSFER ||
    t === TxType.WITHDRAWAL ||
    t === TxType.PERMITTABLE_DEPOSIT
  ) {
    return t
  } else {
    throw new Error('incorrect tx type')
  }
}

const txTypePrefixLen = {
  [TxType.DEPOSIT]: 16,
  [TxType.TRANSFER]: 16,
  // 16 + 16 + 40
  [TxType.WITHDRAWAL]: 72,
  [TxType.PERMITTABLE_DEPOSIT]: 72,
}

export function truncateMemoTxPrefix(memo: string, txType: TxType) {
  const txSpecificPrefixLen = txTypePrefixLen[txType]
  return memo.slice(txSpecificPrefixLen)
}

export function truncateHexPrefix(data: string) {
  if (data.startsWith('0x')) {
    data = data.slice(2)
  }
  return data
}

export function numToHex(num: BN, pad = 64) {
  if (num.isNeg()) {
    let a = toBN(2).pow(toBN(pad * 4))
    num = a.sub(num.neg())
  }
  const hex = truncateHexPrefix(numberToHex(num))
  if (hex.length > pad) {
    logger.error(`hex size overflow: ${hex}; pad: ${pad}`)
  }
  return padLeft(hex, pad)
}

export function flattenProof(p: SnarkProof): string {
  return [p.a, p.b.flat(), p.c].flat().map(n => {
    const hex = numToHex(toBN(n))
    return hex
  }).join('')
}

export async function setIntervalAndRun(f: () => (Promise<void> | void), interval: number) {
  const handler = setInterval(f, interval)
  await f()
  return handler
}