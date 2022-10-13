import './env'
import BN from 'bn.js'
import PoolAbi from './abi/pool-abi.json'
import { AbiItem, toBN } from 'web3-utils'
import { Contract } from 'web3-eth-contract'
import config from './config'
import { web3 } from './services/web3'
import { logger } from './services/appLogger'
import { poolTxQueue } from './queue/poolTxQueue'
import { getEvents, getTransaction } from './utils/web3'
import { Helpers, Params, Proof, SnarkProof, VK } from 'libzkbob-rs-node'
import { validateTx } from './validateTx'
import { PoolState } from './state'

import { TxType } from 'zp-memo-parser'
import { numToHex, numToTxType, toTxType, truncateHexPrefix, truncateMemoTxPrefix } from './utils/helpers'
import { PoolCalldataParser } from './utils/PoolCalldataParser'
import { OUTPLUSONE } from './utils/constants'
import { Chain } from './chains/chain'
import { initPolkadot, PolkadotChain } from './chains/polkadot'
import { EvmChain } from './chains/evm'
import { NearChain } from './chains/near'

export interface PoolTx {
  proof: Proof
  memo: string
  txType: TxType
  depositSignature: string | null
  depositId: number | null
  fromAddress: string | null
}

export interface Limits {
  tvlCap: BN
  tvl: BN
  dailyDepositCap: BN
  dailyDepositCapUsage: BN
  dailyWithdrawalCap: BN
  dailyWithdrawalCapUsage: BN
  dailyUserDepositCap: BN
  dailyUserDepositCapUsage: BN
  depositCap: BN
}

export interface LimitsFetch {
  deposit: {
    singleOperation: string
    daylyForAddress: {
      total: string
      available: string
    }
    daylyForAll: {
      total: string
      available: string
    }
    poolLimit: {
      total: string
      available: string
    }
  }
  withdraw: {
    daylyForAll: {
      total: string
      available: string
    }
  }
}

class Pool {
  public treeParams: Params
  private txVK: VK
  public state: PoolState
  public optimisticState: PoolState
  public denominator: BN = toBN(1)
  public isInitialized = false
  public chain: Chain

  constructor(chain: Chain) {
    this.treeParams = Params.fromFile(config.treeUpdateParamsPath)
    this.txVK = require(config.txVKPath)

    this.state = new PoolState(`${config.storagePrefix || config.chain}.${config.tokenAddress}.pool`)
    this.optimisticState = new PoolState(`${config.storagePrefix || config.chain}.${config.tokenAddress}.optimistic`)
    this.chain = chain
  }

  async init() {
    if (this.isInitialized) return

    this.denominator = toBN(await this.chain.getDenominator())
    await this.syncState()
    this.isInitialized = true
  }

  async transact(txs: PoolTx[]) {
    for (const tx of txs) {
      await validateTx(tx)
    }

    const queueTxs = txs.map(({ proof, txType, memo, depositSignature, depositId, fromAddress }) => {
      return {
        amount: '0',
        gas: config.relayerGasLimit.toString(),
        txProof: proof,
        txType,
        rawMemo: memo,
        depositSignature,
        depositId,
        fromAddress,
      }
    })
    const job = await poolTxQueue.add('tx', queueTxs)
    logger.debug(`Added job: ${job.id}`)
    return job.id
  }

  async syncState(fromBlock: number | string = 'earliest') {
    logger.debug('Syncing state...')

    const localIndex = this.state.getNextIndex()
    const localRoot = this.state.getMerkleRoot()

    const contractIndex = await this.getContractIndex()
    const contractRoot = await this.getContractMerkleRoot(contractIndex)

    logger.debug(`LOCAL ROOT: ${localRoot}; LOCAL INDEX: ${localIndex}`)
    logger.debug(`CONTRACT ROOT: ${contractRoot}; CONTRACT INDEX: ${contractIndex}`)

    if (contractRoot === localRoot && contractIndex === localIndex) {
      logger.info('State is ok, no need to resync')
      return
    }

    const numTxs = Math.floor((contractIndex - localIndex) / OUTPLUSONE)
    const missedIndices = Array(numTxs)
    for (let i = 0; i < numTxs; i++) {
      missedIndices[i] = localIndex + (i + 1) * OUTPLUSONE
    }

    const events = await this.chain.getNewEvents()

    // const events = await getEvents(this.PoolInstance, 'Message', {
    //   fromBlock,
    //   filter: {
    //     index: missedIndices,
    //   },
    // })

    // if (events.length !== missedIndices.length) {
    //   logger.error('Not all events found')
    //   return
    // }

    for (let i = 0; i < events.length; i++) {
      const { data, transactionHash } = events[i]
      // const { input } = await getTransaction(web3, transactionHash)
      // const calldata = Buffer.from(truncateHexPrefix(input), 'hex')

      const parser = pool.chain.parseCalldata(data)

      // await this.state.nullifiers.add([web3.utils.hexToNumberString(nullifier)])
      await this.state.nullifiers.add([parser.nullifier.toString()])

      const outCommit = parser.outCommit
      // const outCommit = web3.utils.hexToNumberString(outCommitRaw)

      const txTypeRaw = parser.txType
      const txType = numToTxType(txTypeRaw)

      const memoRaw = Buffer.from(parser.memo).toString('hex')

      const truncatedMemo = truncateMemoTxPrefix(memoRaw, txType)
      const commitAndMemo = numToHex(outCommit).concat(transactionHash.slice(2)).concat(truncatedMemo)

      const index = parser.transferIndex.toNumber() - OUTPLUSONE
      for (let state of [this.state, this.optimisticState]) {
        state.addCommitment(Math.floor(index / OUTPLUSONE), Helpers.strToNum(outCommit.toString()))
        state.addTx(index, Buffer.from(commitAndMemo, 'hex'))
      }
    }

    logger.debug(`LOCAL ROOT AFTER UPDATE ${this.state.getMerkleRoot()}`)
  }

  verifyProof(proof: SnarkProof, inputs: Array<string>) {
    return Proof.verify(this.txVK, proof, inputs)
  }

  async getContractIndex() {
    const poolIndex = await this.chain.getContractTransferNum()
    return Number(poolIndex)
  }

  async getContractMerkleRoot(index: string | number | undefined): Promise<string> {
    if (!index) {
      index = await this.getContractIndex()
      logger.info('CONTRACT INDEX %d', index)
    }
    const root = await this.chain.getContractMerkleRoot(index)
    return root.toString()
  }

  async getLimitsFor(address: string): Promise<Limits> {
    // const limits = await this.PoolInstance.methods.getLimitsFor(address).call()
    const MAX_LIMIT = toBN(2).pow(toBN(128)).sub(toBN(1))

    return {
      tvlCap: MAX_LIMIT,
      tvl: MAX_LIMIT,
      dailyDepositCap: MAX_LIMIT,
      dailyDepositCapUsage: MAX_LIMIT,
      dailyWithdrawalCap: MAX_LIMIT,
      dailyWithdrawalCapUsage: MAX_LIMIT,
      dailyUserDepositCap: MAX_LIMIT,
      dailyUserDepositCapUsage: MAX_LIMIT,
      depositCap: MAX_LIMIT,
    }
  }

  processLimits(limits: Limits): LimitsFetch {
    const limitsFetch = {
      deposit: {
        singleOperation: limits.depositCap.toString(10),
        daylyForAddress: {
          total: limits.dailyUserDepositCap.toString(10),
          available: limits.dailyUserDepositCap.sub(limits.dailyUserDepositCapUsage).toString(10),
        },
        daylyForAll: {
          total: limits.dailyDepositCap.toString(10),
          available: limits.dailyDepositCap.sub(limits.dailyDepositCapUsage).toString(10),
        },
        poolLimit: {
          total: limits.tvlCap.toString(10),
          available: limits.tvlCap.sub(limits.tvl).toString(10),
        },
      },
      withdraw: {
        daylyForAll: {
          total: limits.dailyWithdrawalCap.toString(10),
          available: limits.dailyWithdrawalCap.sub(limits.dailyWithdrawalCapUsage).toString(10),
        },
      },
    }
    return limitsFetch
  }
}

export let pool: Pool

export async function initPool() {
  let chain: Chain
  switch (config.chain) {
    case 'evm': chain = new EvmChain(); break
    case 'polkadot': chain = new PolkadotChain(); break
    case 'near': chain = new NearChain(); break
    default: throw new Error(`Uknown chain '${config.chain}'`)
  }

  await chain.init()

  pool = new Pool(chain)
  await pool.init()
}

export type { Pool }
