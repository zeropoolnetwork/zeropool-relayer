import './env'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem } from 'web3-utils'
import { Contract } from 'web3-eth-contract'
import { config } from './config/config'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { redis } from './services/redisClient'
import { TxType } from './utils/helpers'
import { decodeMemo } from './utils/memo'
import { TX_QUEUE_NAME } from './utils/constants'
import { Queue } from 'bullmq'
import {
  Params,
  TreePub,
  TreeSec,
  Proof,
  MerkleTree,
  TxStorage,
  Helpers,
  MerkleProof,
  TransferPub,
  TransferSec,
  Constants,
  SnarkProof,
  VK
} from 'libzeropool-rs-node'
import txVK from '../transfer_verification_key.json'

export interface TxPayload {
  to: string
  amount: string
  gas: string | number
  txProof: Proof
  txType: TxType
  rawMemo: string
  depositSignature: string | null
}

class Pool {
  public PoolInstance: Contract
  private treeParams: Params
  private txParams: Params
  private txVK: VK
  public tree: MerkleTree
  public txs: TxStorage
  private txQueue: Queue<TxPayload>

  constructor() {
    this.PoolInstance = new web3.eth.Contract(PoolAbi as AbiItem[], config.poolAddress)

    this.treeParams = Params.fromFile('./tree_params.bin')
    this.txParams = Params.fromFile('./transfer_params.bin')

    this.txVK = txVK

    this.tree = new MerkleTree('./tree.db')
    this.txs = new TxStorage('./txs.db')
    this.txQueue = new Queue(TX_QUEUE_NAME, {
      connection: redis
    })

    this.syncState()
  }

  async transact(txProof: Proof, rawMemo: string, txType: TxType = TxType.TRANSFER, depositSignature: string | null) {
    logger.debug('Adding tx job to queue')
    // TODO maybe store memo in redis as a path to a file
    const job = await this.txQueue.add('test-tx', {
      to: config.poolAddress,
      amount: '0',
      gas: 5000000,
      txProof,
      txType,
      rawMemo,
      depositSignature
    })
    logger.debug(`Added job: ${job.id}`)
  }

  getVirtualTreeProof(hashes: Buffer[]) {
    logger.debug(`Building virtual tree proof...`)
    const outCommit = Helpers.outCommitmentHash(hashes)
    const nextCommitIndex = Math.floor(this.tree.getNextIndex() / 128)
    const prevCommitIndex = nextCommitIndex - 1

    const transferNum = nextCommitIndex * 128
    const root_before = this.tree.getRoot()
    const root_after = this.tree.getVirtualNode(
      Constants.HEIGHT,
      0,
      [[[Constants.OUTLOG, nextCommitIndex], outCommit]],
      transferNum,
      transferNum + 128
    )

    const proof_filled = this.tree.getCommitmentProof(prevCommitIndex)
    const proof_free = this.tree.getCommitmentProof(nextCommitIndex)

    const leaf = outCommit
    const prev_leaf = this.tree.getNode(Constants.OUTLOG, prevCommitIndex)

    logger.debug(`Virtual root ${root_after}; Commit ${outCommit}; Index ${nextCommitIndex}`)

    logger.debug('Proving tree...')
    const proof = Proof.tree(
      this.treeParams,
      {
        root_before,
        root_after,
        leaf,
      },
      {
        proof_filled,
        proof_free,
        prev_leaf,
      }
    )
    logger.debug('proved')

    return {
      proof,
      transferNum,
    }
  }

  async appendHashes(hashes: Buffer[]) {
    hashes.forEach(h => this.tree.appendHash(h))
  }

  getDbTx(i: number): [string, string] | null {
    const buf = this.txs.get(i)
    if (!buf) return null
    const data = buf.toString()
    const out_commit = data.slice(0, 64)
    const memo = data.slice(64)
    return [out_commit, memo]
  }

  async syncState(fromBlock: number | string = 'earliest') {
    const contractRoot = await this.getContractMerkleRoot(null)
    let localRoot = this.getLocalMerkleRoot()
    logger.debug(`LATEST CONTRACT ROOT ${contractRoot}`)
    logger.debug(`LATEST LOCAL ROOT ${localRoot}`)
    if (contractRoot !== localRoot) {
      logger.debug('ROOT MISMATCH')

      // Zero out existing hashes
      const nextIndex = this.tree.getNextIndex()
      for (let i = 0; i < nextIndex; i++) {
        const emptyHash = Buffer.alloc(32)
        this.tree.addHash(i, emptyHash)
      }

      const events = await this.PoolInstance.getPastEvents('Message', { fromBlock })
      let leafIndex = 0
      events.forEach(async ({ returnValues, transactionHash }) => {
        const memoString: string = returnValues.message
        if (!memoString) return
        const buf = Buffer.from(memoString.slice(2), 'hex')
        const memo = decodeMemo(buf, null)
        const notes = memo.noteHashes

        this.tree.addHash(leafIndex, memo.accHash)
        for (let i = 0; i < 127; i++) {
          this.tree.addHash(leafIndex + i + 1, notes[i])
        }
        leafIndex += 128
      })
      localRoot = this.getLocalMerkleRoot()
      logger.debug(`LATEST LOCAL ROOT AFTER UPDATE ${localRoot}`)
    }
  }

  getTxProof(pub: TransferPub, sec: TransferSec) {
    return Proof.tx(this.txParams, pub, sec)
  }

  getTreeProof(pub: TreePub, sec: TreeSec): Proof {
    return Proof.tree(this.treeParams, pub, sec)
  }

  verifyProof(proof: SnarkProof, inputs: Array<string>) {
    return Proof.verify(this.txVK, proof, inputs)
  }

  async getContractMerkleRoot(index: string | undefined | null): Promise<string> {
    if (!index) {
      index = await this.PoolInstance.methods.transfer_num().call()
    }
    const root = await this.PoolInstance.methods.roots(index).call()
    return root.toString()
  }

  getLocalMerkleRoot(): string {
    return this.tree.getRoot()
  }

  getMerkleProof(noteIndex: number): MerkleProof {
    logger.debug(`Merkle proof for index ${noteIndex}`)
    return this.tree.getProof(noteIndex)
  }

  getTransactions(limit: number, offset: number) {
    const txs: (Buffer | null)[] = new Array(limit)
    offset = Math.ceil(offset / 128)
    for (let i = 0; i < limit; i++) {
      txs[i] = this.txs.get(offset + i * 128)
    }
    return txs
  }
}

export const pool = new Pool()
