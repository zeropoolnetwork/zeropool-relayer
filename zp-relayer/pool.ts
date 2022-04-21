import './env'
import BN from 'bn.js'
import { toBN, hexToNumber, hexToNumberString } from 'web3-utils'
import { Mutex } from 'async-mutex'
import { config } from './config/config'
import { api } from './services/polkadot'
import { logger } from './services/appLogger'
import { txQueue } from './services/jobQueue'
import { OUTPLUSONE } from './utils/constants'
import { getEvents as getNewEvents } from './utils/polkadot'
import { PoolCalldataParser } from './utils/PoolCalldataParser'
import { readLatestCheckedBlock, RelayerKeys, updateField } from './utils/redisFields'
import { numToHex, toTxType, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import {
  Params,
  TreePub,
  TreeSec,
  Proof,
  MerkleTree,
  TxStorage,
  MerkleProof,
  Constants,
  SnarkProof,
  VK,
  Helpers,
} from 'libzeropool-rs-node'
import { TxType } from 'zp-memo-parser'

const syncMutex = new Mutex()
class Pool {
  private treeParams: Params
  private txVK: VK
  public tree: MerkleTree
  public txs: TxStorage
  public chainId: number = 0
  public denominator: BN = toBN(1)
  public isInitialized = false

  constructor() {
    this.treeParams = Params.fromFile('./params/tree_params.bin')

    const txVK = require('./params/transfer_verification_key.json')
    this.txVK = txVK

    this.tree = new MerkleTree('./tree.db')
    this.txs = new TxStorage('./txs.db')
  }

  async init() {
    this.denominator = toBN(1000)
    // Work around for the slow start of the substrate node.
    // await this.syncState()
    this.isInitialized = true
  }

  async transact(txProof: Proof, rawMemo: string, txType: TxType = TxType.TRANSFER, depositSignature: string | null) {
    logger.debug('Adding tx job to queue')
    // TODO maybe store memo in redis as a path to a file
    const job = await txQueue.add('test-tx', {
      to: config.poolAddress,
      amount: '0',
      txProof,
      txType,
      rawMemo,
      depositSignature,
    })
    logger.debug(`Added job: ${job.id}`)
    return job.id
  }

  getVirtualTreeProof(outCommit: string, transferNum: number) {
    logger.debug(`Building virtual tree proof...`)
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

    logger.debug('Proving tree...')
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
    const proof = Proof.tree(
      this.treeParams,
      treePub,
      treeSec
    )
    logger.debug('Tree proved')

    return {
      proof,
      nextCommitIndex,
    }
  }

  addCommitment(index: number, commit: Buffer) {
    this.tree.addCommitment(index, commit)
  }

  getDbTx(i: number): [string, string] | null {
    const buf = this.txs.get(i)
    if (!buf) return null
    const data = buf.toString()
    const out_commit = data.slice(0, 64)
    const memo = data.slice(64)
    return [out_commit, memo]
  }

  async syncState() {
    if (syncMutex.isLocked()) {
      logger.debug('Sync already in progress')
      await syncMutex.waitForUnlock()
      return
    }

    await syncMutex.runExclusive(async () => {
      logger.debug('Syncing state...')
      const contractRoot = await this.getContractMerkleRoot(null)
      let localRoot = this.getLocalMerkleRoot()
      logger.debug(`LATEST CONTRACT ROOT ${contractRoot}`)
      logger.debug(`LATEST LOCAL ROOT ${localRoot}`)
      if (contractRoot !== localRoot) {
        logger.debug('ROOT MISMATCH')

        // // Zero out existing hashes
        // const nextIndex = this.tree.getNextIndex()
        // for (let i = 0; i < nextIndex; i++) {
        //   const emptyHash = Buffer.alloc(32)
        //   this.tree.addHash(i, emptyHash)
        // }
        // // Clear tx storage
        // for (let i = 0; i < nextIndex; i += OUTPLUSONE) {
        //   this.txs.delete(i)
        // }

        const events = await getNewEvents()
        for (let i = 0; i < events.length; i++) {
          const event = events[i]

          if (!event.data) {
            throw new Error('incorrect memo in event')
          }

          const outCommit = hexToNumberString(event.outCommit)
          const truncatedMemo = truncateHexPrefix(event.data)
          const commitAndMemo = numToHex(toBN(outCommit)).concat(truncatedMemo)

          logger.info(`Adding commitment at ${this.txs.count() + i}`)
          this.addCommitment(this.txs.count() + i, Helpers.strToNum(outCommit))

          logger.info(`Adding transaction at ${this.txs.count() + i}`)
          pool.txs.add((this.txs.count() + i) * OUTPLUSONE, Buffer.from(commitAndMemo, 'hex'))
        }

        await updateField(RelayerKeys.TRANSFER_NUM, (events.length + this.txs.count()) * OUTPLUSONE)

        localRoot = this.getLocalMerkleRoot()
        logger.debug(`LATEST LOCAL ROOT AFTER UPDATE ${localRoot}`)

        logger.debug(`Next index after update: ${pool.tree.getNextIndex()}`)
      }
    })
  }

  getTreeProof(pub: TreePub, sec: TreeSec): Proof {
    return Proof.tree(this.treeParams, pub, sec)
  }

  verifyProof(proof: SnarkProof, inputs: Array<string>) {
    return Proof.verify(this.txVK, proof, inputs)
  }

  async getContractTransferNum() {
    const transferNum = await api.query.zeropool.poolIndex()
    return Number(transferNum.toString()) // FIXME: Is this correct?
  }

  async getContractMerkleRoot(index: string | undefined | null): Promise<string> {
    if (!index) {
      index = await (await api.query.zeropool.poolIndex()).toString()
    }
    const root = await api.query.zeropool.roots(index)
    return root.toString()
  }

  getLocalMerkleRoot(): string {
    return this.tree.getRoot()
  }

  getMerkleProof(noteIndex: number): MerkleProof {
    logger.debug(`Merkle proof for index ${noteIndex}`)
    return this.tree.getProof(noteIndex)
  }

  async getTransactions(limit: number, offset: number) {
    await this.syncState()
    const txs: (string | null)[] = []
    for (let i = 0; i < limit; i++) {
      const tx = this.txs.get(offset + i * OUTPLUSONE)
      if (tx) {
        txs[i] = tx.toString('hex')
      } else {
        break;
      }
    }
    return txs
  }
}

export const pool = new Pool()
