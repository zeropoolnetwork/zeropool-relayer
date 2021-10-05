import fs from 'fs'

import { deserialize, BinaryReader } from 'borsh'
import { TxType } from './helpers';

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
  fee = null
  amount = null
  address = null
}

function memoBorshSchema(numNotes = 127) {
  const POLY_1305_TAG_SIZE = 16
  const fields = [
    ['accHash', [32]],
    ['rawNoteHashes', [numNotes * 32]],
    ['a_p_x', 'u256'],
    ['sharedSecretCiphertext', [(numNotes + 1) * 32 + POLY_1305_TAG_SIZE]],
    ['accountCiphertext', [64 + POLY_1305_TAG_SIZE]],
  ]
  for (let i = 0; i < numNotes; i++) {
    fields.push([`a_${i}_x`, 'u256'])
    fields.push([`noteCiphertext_${i}`, [60 + POLY_1305_TAG_SIZE]])
  }
  return new Map([[Memo, {
    kind: 'struct',
    fields
  }]])
}

function splitHashes(rawHashes: Buffer, num: number): Buffer[] {
  const notes = []
  for (let i = 0; i < num; i++) {
    const note_hash = Buffer.from(rawHashes.slice(i * 32, (i + 1) * 32))
    notes.push(note_hash)
  }
  return notes
}

export function decodeMemo(data: Buffer, txType: TxType | null) {
  const reader = new BinaryReader(data)
  if (txType) {
    const fee = reader.readU64()
    if (txType === TxType.WITHDRAWAL) {
      const amount = reader.readU64()
      const addres = reader.readFixedArray(20)
    }
  }
  const numItems = new DataView(reader.readFixedArray(4).buffer).getUint32(0, true)
  const memo: Memo = deserialize(memoBorshSchema(numItems - 1), Memo, data.slice(reader.offset))
  memo.numItems = numItems
  memo.noteHashes = splitHashes(memo.rawNoteHashes, numItems - 1)
  memo.rawBuf = data
  fs.writeFileSync('./data.json', JSON.stringify(memo, null, 2), 'utf-8');
  return memo
}
