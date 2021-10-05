import dotenv from 'dotenv'
dotenv.config()

import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Params, TreePub, TreeSec, SnarkProof, Proof, MerkleTree, TxStorage, Helpers, MerkleProof, TransferPub, TransferSec, Constants } from 'libzeropool-rs-node'
import { assert } from 'console'
import { signAndSend } from './tx/signAndSend'
import { decodeMemo, Memo } from './utils/memo'
import { TxType, numToHex, truncateHexPrefix } from './utils/helpers'
import { logger } from './services/appLogger'

const {
  RPC_URL,
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>

export class Pool {
  private PoolInstance: Contract
  private treeParams: Params
  public tree: MerkleTree
  private txs: TxStorage
  private web3: Web3

  constructor() {
    this.web3 = new Web3(RPC_URL)
    this.PoolInstance = new this.web3.eth.Contract(PoolAbi as AbiItem[], POOL_ADDRESS)
    this.treeParams = Params.fromFile('./tree_params.bin')
    this.tree = new MerkleTree('./tree.db')
    this.txs = new TxStorage('./txs.db')

    this.syncState()
  }

  async transact(txProof: Proof, treeProof: Proof, memo: Memo, txType: TxType = TxType.TRANSFER, depositSignature: string | null) {
    const transferNum: string = await this.PoolInstance.methods.transfer_num().call()

    // Construct tx calldata
    const selector: string = this.PoolInstance.methods.transact().encodeABI()

    const nullifier = numToHex(txProof.inputs[1])
    const out_commit = numToHex(treeProof.inputs[2])

    assert(treeProof.inputs[2] == txProof.inputs[2], 'commmitment error')

    const delta = Helpers.parseDelta(txProof.inputs[3])
    const transfer_index = numToHex(delta.index, 12)
    const enery_amount = numToHex(delta.e, 16)
    const token_amount = numToHex(delta.v, 16)

    const transact_proof = this.flattenProof(txProof.proof)

    const root_after = numToHex(treeProof.inputs[1])
    const tree_proof = this.flattenProof(treeProof.proof)

    const tx_type = txType
    const memo_message = memo.rawBuf.toString('hex')
    const memo_size = numToHex((memo_message.length / 2).toString(), 4)

    const data = [
      selector,
      nullifier,
      out_commit,
      transfer_index,
      enery_amount,
      token_amount,
      transact_proof,
      root_after,
      tree_proof,
      tx_type,
      memo_size,
      memo_message
    ]

    if (depositSignature) {
      depositSignature = truncateHexPrefix(depositSignature)
      data.push(depositSignature)
    }

    // TODO move to config
    const address = this.web3.eth.accounts.privateKeyToAccount(RELAYER_ADDRESS_PRIVATE_KEY).address
    const nonce = await this.web3.eth.getTransactionCount(address)
    logger.debug(`nonce ${nonce}`)
    const res = await signAndSend(
      RELAYER_ADDRESS_PRIVATE_KEY,
      data.join(''),
      nonce,
      // TODO gasPrice
      '',
      toBN(0),
      // TODO gas
      5000000,
      this.PoolInstance.options.address,
      await this.web3.eth.getChainId(),
      this.web3
    )
    // 16 + 16 + 40
    logger.debug(`TX HASH' ${res.transactionHash}`)

    logger.debug('UPDATING TREE')
    this.appendHashes([memo.accHash].concat(memo.noteHashes))

    let txSpecificPrefixLen = txType === TxType.WITHDRAWAL ? 72 : 16
    const truncatedMemo = memo_message.slice(txSpecificPrefixLen)
    this.txs.add(parseInt(transferNum), Buffer.from(out_commit.concat(truncatedMemo), 'hex'))
  }

  processMemo(memoBlock: Buffer, txType: TxType): { memo: Memo, proof: Proof } {
    // Decode memo block
    const memo = decodeMemo(memoBlock, txType)
    logger.debug('Decoded memo block')

    const nextItemIndex = this.tree.getNextIndex()
    const nextCommitIndex = Math.floor(nextItemIndex / 128)
    const prevCommitIndex = nextCommitIndex - 1

    // Get state before processing tx
    const hashes = [memo.accHash].concat(memo.noteHashes)
    const virtualNodes = hashes.map((h, i) => {
      return [[0, nextItemIndex + i], Helpers.numToStr(h)]
    })
    const root_before = this.getLocalMerkleRoot()
    const root_after = this.tree.getVirtualNode(
      Constants.HEIGHT,
      0,
      virtualNodes,
      nextItemIndex,
      nextItemIndex + hashes.length
    )

    const proof_filled = this.tree.getCommitmentProof(prevCommitIndex)
    const proof_free = this.tree.getCommitmentProof(nextCommitIndex)

    const leaf = Pool.outCommit(hashes)
    const prev_leaf = this.tree.getNode(Constants.OUTLOG, prevCommitIndex)

    logger.debug('Proving tree')
    const proof = this.getTreeProof({
      root_before,
      root_after,
      leaf,
    }, {
      proof_filled,
      proof_free,
      prev_leaf,
    })
    logger.debug('proved')

    return { proof, memo }
  }

  static outCommit(hashes: Buffer[]) {
    return Helpers.outCommitmentHash(hashes)
  }

  appendHashes(hashes: Buffer[]) {
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
    const params = Params.fromFile('./transfer_params.bin')
    return Proof.tx(params, pub, sec)
  }

  getTreeProof(pub: TreePub, sec: TreeSec): Proof {
    return Proof.tree(this.treeParams, pub, sec)
  }

  async getContractMerkleRoot(index: string | undefined | null): Promise<string> {
    if (!index) {
      index = await this.PoolInstance.methods.transfer_num().call()
    }
    const root = await this.PoolInstance.methods.roots(index).call()
    return root.toString()
  }

  private flattenProof(p: SnarkProof): string {
    return [p.a, p.b.flat(), p.c].flat().map(n => {
      const hex = numToHex(n)
      return hex
    }).join('')
  }

  getLocalMerkleRoot(): string {
    return this.tree.getRoot()
  }

  getMerkleProof(noteIndex: number): MerkleProof {
    logger.debug(`MERKLE PROOF FOR INDEX ${noteIndex}`)
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
