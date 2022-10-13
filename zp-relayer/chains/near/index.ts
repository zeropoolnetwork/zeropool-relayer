import {
  connect,
  keyStores,
  KeyPair,
  Near,
  Contract,
  DEFAULT_FUNCTION_CALL_GAS,
  Account
} from 'near-api-js'
import { FinalExecutionStatusBasic } from 'near-api-js/lib/providers'
import connectPg from 'pg-promise'
import { BinaryWriter, BinaryReader } from '../../utils/binary'
import BN from 'bn.js'
import { TxType } from 'zp-memo-parser'
import { Proof, SnarkProof } from 'libzkbob-rs-node'

import { Chain, MessageEvent, TxStatus, PoolCalldata } from '../chain'
import { readLatestCheckedBlock, RelayerKeys, updateField } from '../../utils/redisFields'
import config from '../../config'
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

  let nullifier = reader.readU256()
  let outCommit = reader.readU256()
  let transferIndex = reader.readU256()
  let energyAmount = reader.readU256()
  let tokenId = reader.readString()
  let tokenAmount = reader.readU256()
  let delta = reader.readU256()
  let transactProof = reader.readFixedArray(8, () => reader.readU256())
  let rootAfter = reader.readU256()
  let treeProof = reader.readFixedArray(8, () => reader.readU256())
  let txType = reader.readU8()
  let memo = reader.readDynamicBuffer()
  let depositAddress = reader.readString()
  let depositId = reader.readU64()

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

export class NearChain implements Chain {
  near: Near = null!
  account: Account = null!
  poolContract: Contract = null!
  indexer: NearIndexerApi = null!

  async init(): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore()
    const keyPair = KeyPair.fromString(config.relayerPrivateKey)
    await keyStore.setKey(config.nearNetworkId!, config.nearAccountName!, keyPair)

    const connectionConfig = {
      networkId: config.nearNetworkId!,
      nodeUrl: config.nearNodeUrl!,
      walletUrl: config.nearWalletUrl!,
      keyStore,
    }

    this.near = await connect(connectionConfig)
    this.account = await this.near.account(config.nearAccountName!)
    this.poolContract = new Contract(this.account, config.poolAddress!, {
      changeMethods: ['transact', 'lock', 'release'],
      viewMethods: ['pool_index', 'merkle_root'],
    })

    this.indexer = await NearIndexerApi.create(config.nearIndexerUrl!, config.poolAddress!)
  }

  public async processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number }> {
    const { amount, txProof, txType, rawMemo, depositSignature, fromAddress } = tx

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
      tokenId: config.tokenAddress!,
      tokenAmount: delta.tokenAmount,
      delta: new BN(txProof.inputs[3]),
      transactProof: flattenProof(txProof.proof),
      rootAfter: new BN(treeProof.inputs[1]),
      treeProof: flattenProof(treeProof.proof),
      txType: numTxType,
      memo: Buffer.from(rawMemo, 'hex'),
      depositAddress: fromAddress,
      depositId: 0,
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

  async getNewEvents(): Promise<MessageEvent[]> {
    try {
      const fromBlock = await readLatestCheckedBlock()
      const lastBlock = new Date((await this.near.connection.provider.status()).sync_info.latest_block_time).getTime() * 1000000; // Get timestamp in ns. TODO: Use BN?
      const txs = await this.indexer.getTransactions(fromBlock)

      const events: MessageEvent[] = txs.map(tx => {
        return {
          transactionHash: tx.transaction_hash,
          data: tx.args.args_base64,
        }
      })

      logger.debug(`${events.length} Past events obtained`)
      await updateField(RelayerKeys.LATEST_CHECKED_BLOCK, lastBlock)

      return events

    }
    catch (e) {
      logger.error('Failed to sync transactions:', e);
      throw e;
    }
  }

  async getContractTransferNum(): Promise<string> {
    // @ts-ignore
    return await this.account.viewFunction({
      contractId: config.poolAddress!,
      methodName: 'pool_index',
      args: {},
      parse: (val: Uint8Array) => deserializeU256(Buffer.from(val)).toString(),
      stringify: (_: any) => new Buffer(0),
    })
    // const value = await this.poolContract.pool_index()
    // return deserializeU256(value).toString()
  }

  async getContractMerkleRoot(index: string | null | undefined): Promise<string> {
    const arg = serializeU256(new BN(index || '0'))
    // @ts-ignore
    return await this.account.viewFunction({
      contractId: config.poolAddress!,
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
      contractId: config.poolAddress!,
      methodName: 'transact',
      gas: MAX_GAS,
      args: Buffer.from(txConfig.data, 'base64'),
      stringify: (arg: any) => arg,
    })

    const { transaction_outcome: txo, status } = res

    logger.debug('Transaction outcome: %o, status %o', txo, status)

    return txo.id
  }

  async getDenominator(): Promise<string> {
    return '1000000000000000' // TODO
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
