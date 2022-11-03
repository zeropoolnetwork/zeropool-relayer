import './env'
import BN from 'bn.js'
import { toBN } from 'web3-utils'
import config from './config'
import { logger } from './services/appLogger'
import { poolTxQueue } from './queue/poolTxQueue'
import { Helpers, Params, Proof, SnarkProof, VK } from 'libzkbob-rs-node'
import { PoolState } from './state'

import { TxType } from 'zp-memo-parser'
import { numToHex, numToTxType } from './utils/helpers'
import { OUTPLUSONE } from './utils/constants'
import { Chain } from './chains/chain'
// import { PolkadotChain } from './chains/polkadot'
// import { EvmChain } from './chains/evm'
import { NearChain, NearConfig } from './chains/near'
import { readLatestCheckedBlock, RelayerKeys, updateField } from './utils/redisFields';
import { ZeropoolIndexer } from './indexer';

export interface PoolTx {
  proof: Proof
  memo: string
  txType: TxType
  extraData?: string
}

class Pool {
  public treeParams: Params = null!
  private txVK: VK = null!
  public state: PoolState = null!
  public optimisticState: PoolState = null!
  public chain: Chain = null!
  public indexer: ZeropoolIndexer = null!

  static async create(chain: Chain, indexer: ZeropoolIndexer): Promise<Pool> {
    const self = new Pool()

    self.treeParams = Params.fromFile(config.treeUpdateParamsPath)
    self.txVK = require(config.txVKPath)

    self.state = new PoolState(`${config.storagePrefix || config.chain}.${config.tokenAddress}.pool`)
    self.optimisticState = new PoolState(`${config.storagePrefix || config.chain}.${config.tokenAddress}.optimistic`)
    self.chain = chain
    self.indexer = indexer

    await self.syncState()
    return self
  }

  async transact(txs: PoolTx[]): Promise<string | undefined> {
    for (const tx of txs) {
      await this.chain.validateTx(tx)
    }

    const queueTxs = txs.map(({ proof, txType, memo, extraData }) => {
      return {
        amount: '0',
        gas: config.relayerGasLimit.toString(),
        txProof: proof,
        txType,
        rawMemo: memo,
        extraData,
      }
    })
    const job = await poolTxQueue.add('tx', queueTxs)
    logger.debug(`Added job: ${job.id}`)
    return job.id
  }

  async syncState() {
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

    const fromBlock = Number(await readLatestCheckedBlock())
    let latestBlockId = fromBlock
    const numTxs = Math.floor((contractIndex - localIndex) / OUTPLUSONE)


    const LIMIT = 100

    let newNumTxs = 0
    let batch = 0
    let events
    do {
      events = await this.indexer.getTransactions({ block_height: latestBlockId, limit: LIMIT })

      logger.debug(`Found ${events.length} events from block ${fromBlock}`)

      for (let i = 0; i < events.length; i++) {
        const { calldata, hash, block_height } = events[i]
        const poolCalldata = this.chain.parseCalldata(calldata)

        await this.state.nullifiers.add([poolCalldata.nullifier.toString()])

        const outCommit = poolCalldata.outCommit
        const txTypeRaw = poolCalldata.txType
        const txType = numToTxType(txTypeRaw)

        const memoRaw = Buffer.from(poolCalldata.memo).toString('hex')

        const truncatedMemo = this.chain.extractCiphertextFromTx(memoRaw, txType)
        const commitAndMemo = this.chain.prepareTxForStorage(outCommit, hash, truncatedMemo)

        const index = localIndex + (batch * LIMIT + i) * OUTPLUSONE
        for (let state of [this.state, this.optimisticState]) {
          state.addCommitment(Math.floor(index / OUTPLUSONE), Helpers.strToNum(outCommit.toString()))
          state.addTx(index, Buffer.from(commitAndMemo, 'hex')) // store in string format for now
        }

        latestBlockId = block_height + 1
      }

      newNumTxs += events.length
      batch += 1
    } while (events.length == LIMIT)

    if (newNumTxs !== numTxs) {
      logger.error(`Number of received transactions does not match number of transactions in contract. Expected ${numTxs}, got ${newNumTxs}`)
      // return
    }

    await updateField(RelayerKeys.LATEST_CHECKED_BLOCK, latestBlockId)
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
}

export let pool: Pool

export async function initPool() {
  let chain: Chain
  switch (config.chain) {
    // case 'evm': chain = await EvmChain.create(); break
    // case 'polkadot': chain = await PolkadotChain.create(); break
    case 'near': {
      const nearConfig: NearConfig = {
        networkId: config.nearNetworkId,
        nodeUrl: config.rpcUrl,
        poolContractId: config.poolAddress,
        relayerAccountId: config.relayerAddress,
        relayerAccountPrivateKey: config.relayerPrivateKey,
        tokenId: config.tokenAddress!,
      }
      chain = await NearChain.create(nearConfig)
      break
    }
    default: throw new Error(`Unknown chain '${config.chain}'`)
  }

  const indexer = new ZeropoolIndexer(config.indexerUrl)

  pool = await Pool.create(chain, indexer)
}

export type { Pool }
