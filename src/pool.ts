import dotenv from 'dotenv'
dotenv.config()

import Web3 from 'web3'
import { toBN } from 'web3-utils'
import { Contract } from 'web3-eth-contract'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem } from 'web3-utils'
import { Params, TreePub, TreeSec, SnarkProof, Proof, MerkleTree, TxStorage, Helpers } from 'libzeropool-rs-node'
import { decodeMemo } from './memo'
import { assert } from 'console'
import { signAndSend } from './tx/signAndSend'
import { OUTLOG } from './utils/constants'

const {
  RPC_URL,
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>

export class Pool {
  private PoolInstance: Contract
  private treeParams: Params
  tree: MerkleTree
  private txs: TxStorage
  private web3: Web3
  curIndex: bigint

  constructor() {
    this.web3 = new Web3(RPC_URL)
    this.PoolInstance = new this.web3.eth.Contract(PoolAbi as AbiItem[], POOL_ADDRESS)
    this.treeParams = Params.fromFile('./tree_params.bin')
    this.tree = new MerkleTree('./tree.db')
    this.txs = new TxStorage('./txs.db')
    this.curIndex = BigInt(0)

    this.syncState()
  }

  toHex(n: string, pad = 64) {
    const hex = this.web3.utils.numberToHex(n).slice(2)
    return this.web3.utils.padLeft(hex, pad)
  }

  async transact(txProof: Proof, treeProof: Proof) {
    const transferNum = await this.PoolInstance.methods.transfer_num().call()

    // Construct tx calldata
    const selector: string = this.PoolInstance.methods.transact().encodeABI()

    const nullifier = this.toHex(txProof.inputs[1])
    const out_commit = this.toHex(treeProof.inputs[2])

    assert(treeProof.inputs[2] == txProof.inputs[2], 'commmitment error')

    // TODO Should be taken from public input delta
    const transfer_index = this.toHex(transferNum, 12)
    const enery_amount = "0000000000000000000000000000"
    const token_amount = "0000000000000000"

    const transact_proof = this.flattenProof(txProof.proof)

    const root_after = this.toHex(treeProof.inputs[1])
    const tree_proof = this.flattenProof(treeProof.proof)

    // TODO process different tx types
    // use memo_message from user data
    const tx_type = "01"
    const memo_size = "08"
    const memo_fee = "0000000000000000"
    const memo_message = ''

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
      memo_fee,
      memo_message
    ].join('')

    // TODO move to config
    const address = this.web3.eth.accounts.privateKeyToAccount(RELAYER_ADDRESS_PRIVATE_KEY).address
    const nonce = await this.web3.eth.getTransactionCount(address)
    console.log('nonce', nonce)
    const res = await signAndSend(
      RELAYER_ADDRESS_PRIVATE_KEY,
      data,
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

    console.log('TX HASH', res.transactionHash)

    this.txs.add(transferNum, Buffer.from(out_commit.concat(memo_message)))
  }

  getDbTx(i: BigInt): [string, string] | null {
    const buf = this.txs.get(i)
    if (!buf) return null
    const data = buf.toString()
    const out_commit = data.slice(0, 64)
    const memo = data.slice(64)
    return [out_commit, memo]
  }

  appendHashes(hashes: Buffer[]) {
    hashes.forEach(h => this.tree.appendHash(h))
  }

  static outCommit(accHash: Buffer, notes: Buffer[]) {
    const out_hashes = [accHash].concat(notes)
    return Helpers.outCommitmentHash(out_hashes)
  }

  processMemo(memoString: string) {
    // Decode memo block
    const buf = Buffer.from(memoString, 'base64')
    const memo = decodeMemo(buf)
    const notes = memo.getNotes()

    const nextItemIndex = this.tree.getNextIndex()
    const nextCommitIndex = Math.floor(nextItemIndex / 128)
    const prevCommitIndex = nextCommitIndex - 1

    // Get state before processing tx
    const root_before = this.tree.getRoot()
    const proof_filled = this.tree.getCommitmentProof(prevCommitIndex)

    // Fill commitment subtree
    console.log('next index before fill', nextItemIndex)
    this.tree.appendHash(memo.accHash)
    this.appendHashes(notes)
    console.log('next index after fill', this.tree.getNextIndex())

    // Get state after processing tx
    const root_after = this.tree.getRoot()
    const proof_free = this.tree.getCommitmentProof(nextCommitIndex)
    const leaf = this.tree.getNode(OUTLOG, nextCommitIndex)
    const prev_leaf = this.tree.getNode(OUTLOG, prevCommitIndex)

    assert(Pool.outCommit(memo.accHash, notes) === leaf, 'WRONG COMMIT')

    const proof = this.getTreeProof({
      root_before,
      root_after,
      leaf,
    }, {
      proof_filled,
      proof_free,
      prev_leaf,
    })

    return proof
  }

  async syncState(fromBlock: number | string = 'earliest') {
    const events = await this.PoolInstance.getPastEvents('Message', { fromBlock })
    events.forEach(async ({ returnValues, transactionHash }) => {
      const memoString: string = returnValues.message
      if (!memoString) return
      const buf = Buffer.from(memoString)
      const memo = decodeMemo(buf)
      const notes = memo.getNotes()

      this.tree.appendHash(memo.accHash)
      this.appendHashes(notes)
    })

    const contractRoot = await this.curRoot()
    const localRoot = this.tree.getRoot()
    console.log('LATEST CONTRACT ROOT', contractRoot)
    console.log('LATEST LOCAL ROOT', localRoot)
    assert(contractRoot == localRoot)
  }

  getTreeProof(pub: TreePub, sec: TreeSec): Proof {
    return Proof.tree(this.treeParams, pub, sec)
  }

  private async curRoot(): Promise<string> {
    const numTx = await this.PoolInstance.methods.transfer_num().call()
    const root = await this.PoolInstance.methods.roots(numTx).call()
    return root.toString()
  }

  private flattenProof(p: SnarkProof): string {
    return [p.a, p.b.flat(), p.c].flat().map(n => {
      const hex = this.toHex(n)
      return hex
    }).join('')
  }
}
