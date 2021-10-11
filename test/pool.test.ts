import { expect } from 'chai'
import { decodeMemo } from '../src/utils/memo'
import { MerkleTree, Constants, Helpers } from 'libzeropool-rs-node'
import depositMemo from './depositMemo.json'
import fs from 'fs'
import { TxType } from '../src/utils/helpers'

const DB_PATH = './test-tree.db'

describe('Pool', () => {
  it('calculates out commit', () => {
    const tree = new MerkleTree(DB_PATH)

    const buf = Buffer.from(depositMemo, 'hex')
    const memo = decodeMemo(buf, TxType.DEPOSIT)

    tree.appendHash(memo.accHash)
    memo.noteHashes.forEach(n => tree.appendHash(n))

    // Commit calculated from raw hashes
    const out_commit_calc = Helpers.outCommitmentHash([memo.accHash].concat(memo.noteHashes))
    // Commit as a root of subtree with inserted hashes
    const out_commit_node = tree.getNode(Constants.OUTLOG, 0)

    expect(out_commit_calc).eq(out_commit_node)

    fs.rmdirSync(DB_PATH, { recursive: true });
  })
})
