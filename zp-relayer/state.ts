import { logger } from './services/appLogger'
import { OUTPLUSONE } from './utils/constants'
import {
  MerkleTree,
  TxStorage,
  MerkleProof,
  Constants,
  Helpers,
} from 'libzkbob-rs-node'

export class PoolState {
  private name: string
  private tree: MerkleTree
  private txs: TxStorage

  constructor(name: string) {
    this.name = name
    this.tree = new MerkleTree(`./${name}Tree.db`)
    this.txs = new TxStorage(`./${name}Txs.db`)
  }

  getVirtualTreeProofInputs(outCommit: string, transferNum?: number) {
    logger.debug(`Building virtual tree proof...`)

    if (!transferNum) transferNum = this.getNextIndex()

    const nextCommitIndex = Math.floor(transferNum / OUTPLUSONE)
    const prevCommitIndex = nextCommitIndex - 1

    const root_before = this.tree.getRoot()
    const root_after = this.tree.getVirtualNode(
      Constants.HEIGHT,
      0,
      [[[Constants.OUTLOG, nextCommitIndex], outCommit]],
      transferNum,
      transferNum + OUTPLUSONE
    )

    const proof_filled = this.tree.getCommitmentProof(prevCommitIndex)
    const proof_free = this.tree.getCommitmentProof(nextCommitIndex)

    const leaf = outCommit
    const prev_leaf = this.tree.getNode(Constants.OUTLOG, prevCommitIndex)

    logger.debug(`Virtual root ${root_after}; Commit ${outCommit}; Index ${nextCommitIndex}`)

    const treePub = {
      root_before,
      root_after,
      leaf,
    }
    const treeSec = {
      proof_filled,
      proof_free,
      prev_leaf,
    }

    return {
      pub: treePub,
      sec: treeSec,
      commitIndex: nextCommitIndex
    }
  }

  addCommitment(index: number, commit: Buffer) {
    this.tree.addCommitment(index, commit)
  }

  getCommitment(index: number) {
    return this.tree.getNode(Constants.OUTLOG, index)
  }

  addHash(i: number, hash: Buffer) {
    this.tree.addHash(i, hash)
  }

  getDbTx(i: number): [string, string] | null {
    const buf = this.txs.get(i)
    if (!buf) return null
    const data = buf.toString()
    const outCommit = data.slice(0, 64)
    const memo = data.slice(64)
    return [outCommit, memo]
  }

  getMerkleRoot(): string {
    return this.tree.getRoot()
  }

  getMerkleProof(noteIndex: number): MerkleProof {
    logger.debug(`Merkle proof for index ${noteIndex}`)
    return this.tree.getProof(noteIndex)
  }

  getNextIndex(): number {
    return this.tree.getNextIndex()
  }

  addTx(i: number, tx: Buffer) {
    this.txs.add(i, tx)
  }

  deleteTx(i: number) {
    this.txs.delete(i)
  }

  updateState(commitIndex: number, outCommit: string, txData: string) {
    logger.debug(`Updating ${this.name} state tree`)
    this.addCommitment(commitIndex, Helpers.strToNum(outCommit))

    logger.debug(`Adding tx to ${this.name} state storage`)
    this.addTx(commitIndex * OUTPLUSONE, Buffer.from(txData, 'hex'))
  }

  rollbackTo(otherState: PoolState) {
    const otherStateNextIndex = otherState.tree.getNextIndex()
    this.tree.rollback(otherStateNextIndex)
  }

  async getTransactions(limit: number, offset: number) {
    const txs: string[] = []
    let nextOffset = Math.floor(offset / OUTPLUSONE) * OUTPLUSONE
    for (let i = 0; i < limit; i++) {
      nextOffset = offset + i * OUTPLUSONE
      const tx = this.txs.get(nextOffset)
      if (tx) {
        txs[i] = tx.toString('hex')
      } else {
        break;
      }
    }
    return { txs, nextOffset }
  }
}