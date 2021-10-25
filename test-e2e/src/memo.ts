import BN from 'bn.js'
import { Buffer } from 'buffer'
import { deserialize, BinaryReader } from 'borsh'


export enum TxType {
  DEPOSIT = '00',
  TRANSFER = '01',
  WITHDRAWAL = '02',
}

// Size in bytes
const U256_SIZE = 32
const POLY_1305_TAG_SIZE = 16
const ACCOUNT_SIZE = 64
const NOTE_SIZE = 60
const ZERO_NOTE_HASH = Uint8Array.from([205,67,21,69,218,80,86,210,193,254,80,77,140,200,120,159,225,78,91,230,207,158,63,231,197,180,251,16,82,219,170,14])


class Assignable {
  constructor(properties: Object) {
    Object.keys(properties).map((key) => {
      // @ts-ignore
      this[key] = properties[key];
    });
  }
}

export class Memo extends Assignable {
  rawBuf!: Uint8Array
  numItems!: number
  accHash!: Uint8Array
  noteHashes!: Uint8Array[]
  rawNoteHashes!: Buffer
  a_p_x!: number
  fee!: BN | null
  amount!: BN | null
  address!: Uint8Array | null
}

function memoBorshSchema(numNotes: number) {
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

function getNoteHashes(rawHashes: Buffer, num: number, maxNotes: number): Uint8Array[] {
  const notes = []
  for (let i = 0; i < num; i++) {
    const start = i * U256_SIZE
    const end = start + U256_SIZE
    const note_hash = Buffer.from(rawHashes.slice(start, end))
    notes.push(note_hash)
  }
  // Append zero note hashes
  for (let i = num; i < maxNotes; i++) {
    notes.push(ZERO_NOTE_HASH)
  }
  return notes
}

export function decodeMemo(data: Buffer, txType: TxType | null, maxNotes = 127) {
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
  memo.noteHashes = getNoteHashes(memo.rawNoteHashes, numItems - 1, maxNotes)
  memo.rawBuf = data
  memo.fee = fee
  memo.amount = amount
  memo.address = addres
  return memo
}
