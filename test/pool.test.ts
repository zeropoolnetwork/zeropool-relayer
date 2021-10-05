import { expect } from 'chai'
import { decodeMemo } from '../src/memo'
import { Pool } from '../src/pool'
import { MerkleTree, Constants } from 'libzeropool-rs-node'
import depositMemo from './depositMemo.json'
import fs from 'fs'
import { TxType } from '../src/utils/helpers'

const DB_PATH = './test-tree.db'

describe('Pool', () => {
  it('calculates out commit', () => {
    const tree = new MerkleTree(DB_PATH)

    const buf = Buffer.from(depositMemo, 'hex')
    const memo = decodeMemo(buf, TxType.DEPOSIT)
    const notes = memo.getNotes()

    tree.appendHash(memo.accHash)
    notes.forEach(n => tree.appendHash(n))

    // Commit calculated from raw hashes
    const out_commit_calc = Pool.outCommit(memo.accHash, notes)
    // Commit as a root of subtree with inserted hashes
    const out_commit_node = tree.getNode(Constants.OUTLOG, 0)

    expect(out_commit_calc).eq(out_commit_node)

    fs.rmdirSync(DB_PATH, { recursive: true });
  })
})
