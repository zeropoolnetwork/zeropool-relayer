import './env'
import BN from 'bn.js'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Contract } from 'web3-eth-contract'
import { config } from './config/config'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'
import { OUTPLUSONE } from './utils/constants'
import { getEvents, getTransaction, getChainId } from './utils/web3'
import { PoolCalldataParser } from './utils/PoolCalldataParser'
import { updateField, RelayerKeys } from './utils/redisFields'
import { numToHex, toTxType, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import {
  Params,
  Proof,
  SnarkProof,
  VK,
  Helpers,
} from 'libzeropool-rs-node'
import {
  checkAssertion,
  checkNativeAmount,
  checkFee,
  checkNullifier,
  checkTransferIndex,
  checkTxProof,
  checkTxSpecificFields,
  parseDelta,
} from './validation'
import { PoolState } from './state'

import { getTxData, TxType, WithdrawTxData } from 'zp-memo-parser'

class Pool {
  public PoolInstance: Contract
  public treeParams: Params
  private txVK: VK
  public state: PoolState
  public optimisticState: PoolState
  public chainId: number = 0
  public denominator: BN = toBN(1)
  public isInitialized = false

  constructor() {
    this.PoolInstance = new web3.eth.Contract(PoolAbi as AbiItem[], config.poolAddress)

    this.treeParams = Params.fromFile(config.treeUpdateParamsPath)
    const txVK = require(config.txVKPath)
    this.txVK = txVK

    this.state = new PoolState('pool')
    this.optimisticState = new PoolState('optimistic')
  }

  async init() {
    if (this.isInitialized) return

    this.chainId = await getChainId(web3)
    this.denominator = toBN(await this.PoolInstance.methods.denominator().call())
    await this.syncState()
    this.isInitialized = true
  }

  async transact(txProof: Proof, rawMemo: string, txType: TxType = TxType.TRANSFER, depositSignature: string | null) {
    logger.debug('Adding tx job to queue')

    await checkAssertion(
      () => checkNullifier(txProof.inputs[1]),
      `Doublespend detected`
    )

    const buf = Buffer.from(rawMemo, 'hex')
    const txData = getTxData(buf, txType)
    const nativeAmount = txType === TxType.WITHDRAWAL ? (txData as WithdrawTxData).nativeAmount : null

    await checkAssertion(
      () => checkFee(txData.fee),
      `Fee too low`
    )

    await checkAssertion(
      () => checkNativeAmount(nativeAmount),
      `Native amount too high`
    )

    await checkAssertion(
      () => checkTxProof(txProof),
      `Incorrect transfer proof`
    )

    const contractTransferIndex = await this.getContractTransferNum()
    const delta = parseDelta(txProof.inputs[3])

    await checkAssertion(
      () => checkTransferIndex(toBN(contractTransferIndex), delta.transferIndex),
      `Incorrect transfer index`
    )

    await checkAssertion(
      () => checkTxSpecificFields(
        txType,
        delta.tokenAmount,
        delta.energyAmount,
        txData,
        toBN('0')
      ),
      `Tx specific fields are incorrect`
    )

    const job = await poolTxQueue.add('tx', {
      amount: '0',
      gas: config.relayerGasLimit.toString(),
      txProof,
      txType,
      rawMemo,
      depositSignature,
    })
    logger.debug(`Added job: ${job.id}`)
    return job.id
  }

  async syncState(fromBlock: number | string = 'earliest') {
    logger.debug('Syncing state...')
    const contractRoot = await this.getContractMerkleRoot(null)
    let localRoot = this.state.getMerkleRoot()
    logger.debug(`LATEST CONTRACT ROOT ${contractRoot}`)
    logger.debug(`LATEST LOCAL ROOT ${localRoot}`)
    if (contractRoot !== localRoot) {
      logger.debug('ROOT MISMATCH')

      // Zero out existing hashes
      const nextIndex = this.state.getNextIndex()
      for (let i = 0; i < nextIndex; i++) {
        const emptyHash = Buffer.alloc(32)
        this.state.addHash(i, emptyHash)
      }
      // Clear tx storage
      for (let i = 0; i < nextIndex; i += OUTPLUSONE) {
        this.state.deleteTx(i)
      }

      const events = await getEvents(this.PoolInstance, 'Message', { fromBlock })
      for (let txNum = 0; txNum < events.length; txNum++) {
        const { returnValues, transactionHash } = events[txNum]

        const memoString: string = returnValues.message
        if (!memoString) {
          throw new Error('incorrect memo in event')
        }

        const { input } = await getTransaction(web3, transactionHash)
        const calldata = Buffer.from(truncateHexPrefix(input), 'hex')

        const parser = new PoolCalldataParser(calldata)

        const outCommitRaw = parser.getField('outCommit')
        const outCommit = web3.utils.hexToNumberString(outCommitRaw)

        const txTypeRaw = parser.getField('txType')
        const txType = toTxType(txTypeRaw)

        const memoSize = web3.utils.hexToNumber(parser.getField('memoSize'))
        const memoRaw = truncateHexPrefix(parser.getField('memo', memoSize))

        const truncatedMemo = truncateMemoTxPrefix(memoRaw, txType)
        const commitAndMemo = numToHex(toBN(outCommit)).concat(transactionHash.slice(2)).concat(truncatedMemo)

        this.state.addCommitment(txNum, Helpers.strToNum(outCommit))
        this.state.addTx(txNum * OUTPLUSONE, Buffer.from(commitAndMemo, 'hex'))
      }

      await updateField(RelayerKeys.TRANSFER_NUM, events.length * OUTPLUSONE)

      localRoot = this.state.getMerkleRoot()
      logger.debug(`LATEST LOCAL ROOT AFTER UPDATE ${localRoot}`)
    }
  }

  verifyProof(proof: SnarkProof, inputs: Array<string>) {
    return Proof.verify(this.txVK, proof, inputs)
  }

  async getContractTransferNum() {
    const transferNum = await pool.PoolInstance.methods.pool_index().call()
    return Number(transferNum)
  }

  async getContractMerkleRoot(index: string | undefined | null): Promise<string> {
    if (!index) {
      index = await this.PoolInstance.methods.pool_index().call()
    }
    const root = await this.PoolInstance.methods.roots(index).call()
    return root.toString()
  }
}

export const pool = new Pool()
export type { Pool }
