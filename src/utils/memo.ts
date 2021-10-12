import fs from 'fs'

import BN from 'bn.js'
import { deserialize, BinaryReader } from 'borsh'
import { TxType } from './helpers'
import { logger } from '../services/appLogger'

// Size in bytes
const U256_SIZE = 32
const POLY_1305_TAG_SIZE = 16
const ACCOUNT_SIZE = 64
const NOTE_SIZE = 60

class Assignable {
  constructor(properties: Object) {
    Object.keys(properties).map((key) => {
      // @ts-ignore
      this[key] = properties[key];
    });
  }
}

export class Memo extends Assignable {
  rawBuf!: Buffer
  numItems!: number
  accHash!: Buffer
  noteHashes!: Buffer[]
  rawNoteHashes!: Buffer
  a_p_x!: number
  fee!: BN | null
  amount!: BN | null
  address!: Uint8Array | null
}

function memoBorshSchema(numNotes = 127) {
  const fields = [
    ['accHash', [U256_SIZE]],
    ['rawNoteHashes', [numNotes * U256_SIZE]],
    ['a_p_x', 'u256'],
    ['sharedSecretCiphertext', [(numNotes + 1) * U256_SIZE + POLY_1305_TAG_SIZE]],
    ['accountCiphertext', [ACCOUNT_SIZE + POLY_1305_TAG_SIZE]],
  ]
  for (let i = 0; i < numNotes; i++) {
    fields.push([`a_${i}_x`, 'u256'])
    fields.push([`noteCiphertext_${i}`, [NOTE_SIZE + POLY_1305_TAG_SIZE]])
  }
  return new Map([[Memo, {
    kind: 'struct',
    fields
  }]])
}

function splitHashes(rawHashes: Buffer, num: number): Buffer[] {
  const notes = []
  for (let i = 0; i < num; i++) {
    const start = i * U256_SIZE
    const end = start + U256_SIZE
    const note_hash = Buffer.from(rawHashes.slice(start, end))
    notes.push(note_hash)
  }
  return notes
}

export function decodeMemo(data: Buffer, txType: TxType | null) {
  logger.debug('Decoding memo...')
  const reader = new BinaryReader(data)
  let fee = null
  let amount = null
  let addres = null
  if (txType) {
    fee = reader.readU64()
    if (txType === TxType.WITHDRAWAL) {
      amount = reader.readU64()
      addres = reader.readFixedArray(20)
    }
  }
  const numItems = new DataView(reader.readFixedArray(4).buffer).getUint32(0, true)
  const memo: Memo = deserialize(memoBorshSchema(numItems - 1), Memo, data.slice(reader.offset))
  memo.numItems = numItems
  memo.noteHashes = splitHashes(memo.rawNoteHashes, numItems - 1)
  memo.rawBuf = data
  memo.fee = fee
  memo.amount = amount
  memo.address = addres
  fs.writeFileSync('./data.json', JSON.stringify(memo, null, 2), 'utf-8');
  return memo
}
