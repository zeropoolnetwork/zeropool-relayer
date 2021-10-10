import { numberToHex, padLeft, toBN } from 'web3-utils'
import { logger } from '../services/appLogger'
import { SnarkProof } from 'libzeropool-rs-node'

export enum TxType {
  DEPOSIT = '00',
  TRANSFER = '01',
  WITHDRAWAL = '02',
}

export function truncateHexPrefix(data: string) {
  if (data.startsWith('0x')) {
    data = data.slice(2)
  }
  return data
}

export function numToHex(n: string, pad = 64) {
  let num = toBN(n)
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
    const hex = numToHex(n)
    return hex
  }).join('')
}