import {
  connect,
  keyStores,
  KeyPair,
  Near,
  Contract,
  Account
} from 'near-api-js'
import { FinalExecutionStatusBasic } from 'near-api-js/lib/providers'
import { BinaryWriter, BinaryReader } from '../../utils/binary'
import BN from 'bn.js'
import { TxType } from 'zp-memo-parser'
import { Proof, SnarkProof } from 'libzkbob-rs-node'

import { Chain, MessageEvent, TxStatus, PoolCalldata } from '../chain'
import { readLatestCheckedBlock, RelayerKeys, updateField } from '../../utils/redisFields'
import { logger } from '../../services/appLogger'
import { TxPayload } from '../../queue/poolTxQueue'
import { Pool } from '../../pool'
import { parseDelta } from '../../validateTx'
import { NearIndexerApi } from './indexer';

const MAX_GAS = new BN('300000000000000')

// pub struct Tx {
//     pub nullifier: U256,
//     pub out_commit: U256,
//     pub transfer_index: U256,
//     pub energy_amount: U256,
//     pub token_id: AccountId,
//     pub token_amount: U256,
//     pub delta: U256,
//     pub transact_proof: Proof,
//     pub root_after: U256,
//     pub tree_proof: Proof,
//     pub tx_type: TxType,
//     pub memo: Memo,
//     pub deposit_address: AccountId,
//     pub deposit_id: u64,
// }
function serializePoolData(data: PoolCalldata): Buffer {
  const writer = new BinaryWriter()
  writer.writeU256(data.nullifier)
  writer.writeU256(data.outCommit)
  writer.writeU256(data.transferIndex)
  writer.writeU256(data.energyAmount)
  writer.writeString(data.tokenId)
  writer.writeU256(data.tokenAmount)
  writer.writeU256(data.delta)
  for (let element of data.transactProof) {
    writer.writeU256(element)
  }
  writer.writeU256(data.rootAfter)
  for (let element of data.treeProof) {
    writer.writeU256(element)
  }
  writer.writeU8(data.txType)
  writer.writeDynamicBuffer(Buffer.from(data.memo))
  writer.writeString(data.depositAddress)
  writer.writeU64(data.depositId)

  return Buffer.from(writer.toArray())
}

function deserializePoolData(data: Buffer): PoolCalldata {
  const reader = new BinaryReader(data)

  const nullifier = reader.readU256()
  const outCommit = reader.readU256()
  const transferIndex = reader.readU256()
  const energyAmount = reader.readU256()
  const tokenId = reader.readString()
  const tokenAmount = reader.readU256()
  const delta = reader.readU256()
  const transactProof = reader.readFixedArray(8, () => reader.readU256())
  const rootAfter = reader.readU256()
  const treeProof = reader.readFixedArray(8, () => reader.readU256())
  const txType = reader.readU8()
  const memo = reader.readDynamicBuffer()
  const depositAddress = reader.readString()
  const depositId = reader.readU64()

  return new PoolCalldata({
    nullifier,
    outCommit,
    transferIndex,
    energyAmount,
    tokenId,
    tokenAmount,
    delta,
    transactProof,
    rootAfter,
    treeProof,
    txType,
    memo,
    depositAddress,
    depositId,
  })
}

export interface NearConfig {
  networkId: string
  nodeUrl: string
  relayerAccountId: string
  relayerAccountPrivateKey: string
  poolContractId: string
  indexerUrl: string
  tokenId: string
}

export class NearChain extends Chain {
  near: Near = null!
  account: Account = null!
  indexer: NearIndexerApi = null!
  config: NearConfig = null!

  static async create(config: NearConfig): Promise<NearChain> {
    const self = new NearChain();

    self.config = config

    const keyStore = new keyStores.InMemoryKeyStore()
    const keyPair = KeyPair.fromString(config.relayerAccountPrivateKey)
    await keyStore.setKey(config.networkId, config.relayerAccountId!, keyPair)

    const connectionConfig = {
      networkId: config.networkId,
      nodeUrl: config.nodeUrl,
      keyStore,
    }

    self.near = await connect(connectionConfig)
    self.account = await self.near.account(config.relayerAccountId)
    // this.poolContract = new Contract(this.account, config.poolContractId, {
    //   changeMethods: ['transact', 'lock', 'release'],
    //   viewMethods: ['pool_index', 'merkle_root'],
    // })

    self.indexer = await NearIndexerApi.create(config.indexerUrl, config.poolContractId)
    self.denominator = new BN('1000000000000000')

    return self
  }

  public async processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number }> {
    const { amount, txProof, txType, rawMemo, depositId, depositSignature, fromAddress } = tx

    const logPrefix = `Job ${id}:`

    logger.info(`${logPrefix} Received ${txType} tx with ${amount} native amount`)

    const delta = parseDelta(txProof.inputs[3])

    const outCommit = txProof.inputs[2]
    const { pub, sec, commitIndex } = pool.optimisticState.getVirtualTreeProofInputs(outCommit)

    logger.debug(`${logPrefix} Proving tree...`)
    const treeProof = await Proof.treeAsync(pool.treeParams, pub, sec)
    logger.debug(`${logPrefix} Tree proved`)

    let numTxType;
    switch (txType) {
      case TxType.DEPOSIT: numTxType = 0; break
      case TxType.TRANSFER: numTxType = 1; break
      case TxType.WITHDRAWAL: numTxType = 2; break
      default: throw new Error(`Unsupported tx type: ${txType}`)
    }

    const calldata: PoolCalldata = new PoolCalldata({
      nullifier: new BN(txProof.inputs[1]),
      outCommit: new BN(treeProof.inputs[2]),
      transferIndex: delta.transferIndex,
      energyAmount: delta.energyAmount,
      tokenId: this.config.tokenId,
      tokenAmount: delta.tokenAmount,
      delta: new BN(txProof.inputs[3]),
      transactProof: flattenProof(txProof.proof),
      rootAfter: new BN(treeProof.inputs[1]),
      treeProof: flattenProof(treeProof.proof),
      txType: numTxType,
      memo: Buffer.from(rawMemo, 'hex'),
      depositAddress: fromAddress,
      depositId: new BN(depositId!),
    })

    const bin = serializePoolData(calldata)
    const data = Buffer.from(bin).toString('base64')

    return { data, commitIndex }
  }

  parseCalldata(tx: string): PoolCalldata {
    return deserializePoolData(Buffer.from(tx, 'base64'));
  }

  async getTxStatus(txId: any): Promise<{ status: TxStatus, blockId?: any }> {
    const provider = this.near.connection.provider
    const result = await provider.txStatus(txId, this.account.accountId)
    let status

    switch (result.status) {
      case FinalExecutionStatusBasic.Failure: status = TxStatus.Error; break
      default: status = TxStatus.Mined
    }

    return {
      status,
      blockId: result.transaction
    }
  }

  // For near, use block time
  async getLatestBlockId(): Promise<number> {
    const status = await this.near.connection.provider.status()
    const blockTime = new Date(status.sync_info.latest_block_time)
    return blockTime.getTime() * 1000000 // to ns
  }

  async getEvents(fromBlock: number): Promise<MessageEvent[]> {
    try {
      const txs = await this.indexer.getTransactions(fromBlock)

      const events: MessageEvent[] = txs.map(tx => {
        return {
          transactionHash: tx.transaction_hash,
          data: tx.args.args_base64,
        }
      })

      logger.debug(`${events.length} Past events obtained`)

      return events

    }
    catch (e) {
      logger.error('Failed to sync transactions:', e);
      throw e;
    }
  }

  async getContractTransferNum(): Promise<string> {
    return await this.account.viewFunction({
      contractId: this.config.poolContractId,
      methodName: 'pool_index',
      args: {},
      parse: (val: Uint8Array) => deserializeU256(Buffer.from(val)).toString(),
      stringify: (_: any) => new Buffer(0),
    })
  }

  async getContractMerkleRoot(index: string | null | undefined): Promise<string> {
    const arg = serializeU256(new BN(index || '0'))
    return await this.account.viewFunction({
      contractId: this.config.poolContractId,
      methodName: 'merkle_root',
      args: arg,
      parse: (val: Uint8Array) => {
        return deserializeU256(Buffer.from(val.slice(1))).toString()
      },
      stringify: (arg: any) => arg,
    })
  }

  async signAndSend(txConfig: { data: string, nonce: string, gas: string, amount: string }): Promise<string> {
    const res = await this.account.functionCall({
      contractId: this.config.poolContractId,
      methodName: 'transact',
      gas: MAX_GAS,
      args: Buffer.from(txConfig.data, 'base64'),
      stringify: (arg: any) => arg,
    })

    const { transaction_outcome: txo, status } = res

    logger.debug('Transaction outcome: %o, status %o', txo, status)

    return txo.id
  }

  toBaseUnit(amount: BN): BN {
    return this.fromDenominatedAmount(amount)
  }

  fromBaseUnit(amount: BN): BN {
    return this.toDenominatedAmount(amount)
  }
}

export function flattenProof(p: SnarkProof): BN[] {
  return [p.a, p.b.flat(), p.c]
    .flat()
    .map(n => new BN(n))
}

function deserializeU256(data: Buffer): BN {
  return new BN(data, 'le');
}

function serializeU256(data: BN): Buffer {
  return Buffer.from(data.toArray('le', 32));
}
