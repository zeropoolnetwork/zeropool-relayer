import { expect } from 'chai'
import { decodeMemo } from '../src/memo'
import { Pool } from '../src/pool'
import { MerkleTree } from 'libzeropool-rs-node'
import exampleTx from './exampleTx.json'
import { OUTLOG } from '../src/utils/constants'
import fs from 'fs'

const DB_PATH = './test-tree.db'

describe('Pool', () => {
  it('calculates out commit', () => {
    const tree = new MerkleTree(DB_PATH)

    const buf = Buffer.from(exampleTx.memo, 'base64')
    const memo = decodeMemo(buf)
    const notes = memo.getNotes()

    tree.appendHash(memo.accHash)
    notes.forEach(n => tree.appendHash(n))

    // Commit calculated from raw hashes
    const out_commit_calc = Pool.outCommit(memo.accHash, notes)
    // Commit as a root of subtree with inserted hashes
    const out_commit_node = tree.getNode(OUTLOG, 0)

    expect(out_commit_calc).eq(out_commit_node)

    fs.rmdirSync(DB_PATH, { recursive: true });
  })
})