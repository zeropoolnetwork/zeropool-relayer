import dotenv from 'dotenv'
dotenv.config()

import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Params, TreePub, TreeSec, SnarkProof, Proof, MerkleTree, TxStorage, Helpers, MerkleProof, TransferPub, TransferSec } from 'libzeropool-rs-node'
import { decodeMemo } from './memo'
import { assert } from 'console'
import { signAndSend } from './tx/signAndSend'
import { OUTLOG, BALANCE_SIZE, ENERGY_SIZE, HEIGHT } from './utils/constants'
import { TxType } from './utils/helpers'

const {
  RPC_URL,
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>

export class Pool {
  private PoolInstance: Contract
  private treeParams: Params
  private tree: MerkleTree
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

  getTxProof(pub: TransferPub, sec: TransferSec) {
    const params = Params.fromFile('./transfer_params.bin')
    return Proof.tx(params, pub, sec)
  }

  truncateHexPrefix(data: string) {
    if (data.startsWith('0x')) {
      data = data.slice(2)
    }
    return data
  }

  numToHex(n: string, pad = 64) {
    let num = toBN(n)
    if (num.isNeg()) {
      let a = toBN(2).pow(toBN(pad * 4))
      num = a.sub(num.neg())
    }
    const hex = this.truncateHexPrefix(this.web3.utils.numberToHex(num))
    assert(hex.length <= pad, 'hex size overflow')
    return this.web3.utils.padLeft(hex, pad)
  }

  async transact(txProof: Proof, treeProof: Proof, memo: Buffer, txType: TxType = TxType.TRANSFER, depositSignature: string | null) {
    const transferNum: string = await this.PoolInstance.methods.transfer_num().call()

    // Construct tx calldata
    const selector: string = this.PoolInstance.methods.transact().encodeABI()

    const nullifier = this.numToHex(txProof.inputs[1])
    const out_commit = this.numToHex(treeProof.inputs[2])

    assert(treeProof.inputs[2] == txProof.inputs[2], 'commmitment error')

    const delta = Helpers.parseDelta(txProof.inputs[3])
    const transfer_index = this.numToHex(delta.index, 12)
    const enery_amount = this.numToHex(delta.e, 16)
    const token_amount = this.numToHex(delta.v, 16)

    const transact_proof = this.flattenProof(txProof.proof)

    const root_after = this.numToHex(treeProof.inputs[1])
    const tree_proof = this.flattenProof(treeProof.proof)

    // TODO process different tx types
    // use memo_message from user data
    const tx_type = txType
    const memo_message = memo.toString('hex')
    const memo_size = this.numToHex((memo_message.length / 2).toString(), 4)

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
      depositSignature = this.truncateHexPrefix(depositSignature)
      data.push(depositSignature)
    }

    // TODO move to config
    const address = this.web3.eth.accounts.privateKeyToAccount(RELAYER_ADDRESS_PRIVATE_KEY).address
    const nonce = await this.web3.eth.getTransactionCount(address)
    console.log('nonce', nonce)
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

    console.log('TX HASH', res.transactionHash)

    this.txs.add(parseInt(transferNum), Buffer.from(out_commit.concat(memo_message)))
  }

  getDbTx(i: number): [string, string] | null {
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

  processMemo(memoBlock: Buffer, txType: TxType) {
    // Decode memo block
    const memo = decodeMemo(memoBlock, txType)
    const notes = memo.getNotes()

    const nextItemIndex = this.tree.getNextIndex()
    const nextCommitIndex = Math.floor(nextItemIndex / 128)
    const prevCommitIndex = nextCommitIndex - 1

    // Get state before processing tx
    const root_before = this.tree.getRoot()
    const proof_filled = this.tree.getCommitmentProof(prevCommitIndex)
    const proof_free = this.tree.getCommitmentProof(nextCommitIndex)

    // Fill commitment subtree
    console.log('next index before fill', nextItemIndex)
    this.tree.appendHash(memo.accHash)
    this.appendHashes(notes)
    console.log('next index after fill', this.tree.getNextIndex())

    // Get state after processing tx
    const root_after = this.tree.getRoot()
    const leaf = this.tree.getNode(OUTLOG, nextCommitIndex)
    const prev_leaf = this.tree.getNode(OUTLOG, prevCommitIndex)

    assert(Pool.outCommit(memo.accHash, notes) === leaf, 'WRONG COMMIT')

    console.log('Proving tree')
    const proof = this.getTreeProof({
      root_before,
      root_after,
      leaf,
    }, {
      proof_filled,
      proof_free,
      prev_leaf,
    })
    console.log('proved')

    return proof
  }

  async syncState(fromBlock: number | string = 'earliest') {
    const events = await this.PoolInstance.getPastEvents('Message', { fromBlock })
    events.forEach(async ({ returnValues, transactionHash }) => {
      // console.log('EVENT', returnValues)
      const txType: TxType = returnValues.txType
      const memoString: string = returnValues.message
      if (!memoString) return
      const b = this.web3.utils.hexToUtf8(memoString)
      const buf = Buffer.from(b, 'base64')
      console.log(buf)
      const memo = decodeMemo(buf, txType)
      console.log(memo)
      const notes = memo.getNotes()

      this.tree.appendHash(memo.accHash)
      this.appendHashes(notes)
    })

    const contractRoot = await this.curRoot()
    const localRoot = this.tree.getRoot()
    console.log('LATEST CONTRACT ROOT', contractRoot)
    console.log('LATEST LOCAL ROOT', localRoot)
    assert(contractRoot == localRoot, 'Root mismatch')
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
      const hex = this.numToHex(n)
      return hex
    }).join('')
  }

  getMerkleProof(noteIndex: number): MerkleProof {
    return this.tree.getProof(noteIndex)
  }

  getTransactions(limit: number, offset: number) {
    const txs: (Buffer | null)[] = new Array(limit)
    for (let i = offset; i < offset + limit; i++) {
      txs.push(this.txs.get(i))
    }
    return txs
  }
}
