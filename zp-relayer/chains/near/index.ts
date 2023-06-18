import {
  connect,
  keyStores,
  KeyPair,
  Near,
  Contract,
  Account,
  providers,
  DEFAULT_FUNCTION_CALL_GAS,
  Connection,
} from 'near-api-js'
import { FinalExecutionOutcome, FinalExecutionStatusBasic } from 'near-api-js/lib/providers'
import { BinaryWriter, BinaryReader } from '../../utils/binary'
import BN from 'bn.js'
import { TxType } from 'zp-memo-parser'
import { Proof, SnarkProof } from 'libzkbob-rs-node'
import bs58 from 'bs58'

import { Chain, MessageEvent, TxStatus, PoolCalldata } from '../chain'
import { readLatestCheckedBlock, RelayerKeys, updateField } from '../../utils/redisFields'
import { logger } from '../../services/appLogger'
import { TxPayload } from '../../queue/poolTxQueue'
import { Pool } from '../../pool'
import { parseDelta } from '../../validateTx'
import { numToHex, truncateHexPrefix } from '../../utils/helpers';
import { ChangeFunctionCallOptions } from 'near-api-js/lib/account'
import { functionCall } from 'near-api-js/lib/transaction'

const MAX_GAS = new BN('300000000000000')

function serializePoolData(data: PoolCalldata): Buffer {
  const writer = new BinaryWriter()
  writer.writeU256(data.nullifier)
  writer.writeU256(data.outCommit)
  writer.writeString(data.tokenId)
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
  if (data.extraData) {
    writer.writeFixedArray(data.extraData)
  }

  return Buffer.from(writer.toArray())
}

function deserializePoolData(data: Buffer): PoolCalldata {
  const reader = new BinaryReader(data)

  const nullifier = reader.readU256()
  const outCommit = reader.readU256()
  const tokenId = reader.readString()
  const delta = reader.readU256()
  const transactProof = reader.readFixedArray(8, () => reader.readU256())
  const rootAfter = reader.readU256()
  const treeProof = reader.readFixedArray(8, () => reader.readU256())
  const txType = reader.readU8()
  const memo = reader.readDynamicBuffer()
  const extraData = reader.readBufferUntilEnd()

  if (!reader.isEmpty()) {
    throw new Error('pool data is not fully consumed');
  }

  return new PoolCalldata({
    nullifier,
    outCommit,
    tokenId,
    delta,
    transactProof,
    rootAfter,
    treeProof,
    txType,
    memo,
    extraData,
  })
}

export interface NearConfig {
  networkId: string
  nodeUrl: string
  relayerAccountId: string
  relayerAccountPrivateKey: string
  poolContractId: string
  tokenId: string
}

class AsyncAccount extends Account {
  constructor(connection: Connection, accountId: string) {
    super(connection, accountId)
  }

  async functionCallCustom(contractId: string, methodName: string, args: Buffer, gas: BN, attachedDeposit: BN): Promise<string> {
    const action = functionCall(methodName, args, gas, attachedDeposit, (args: any) => args, false)
    const [txHash, signedTx] = await this.signTransaction(contractId, [action])
    await this.connection.provider.sendTransaction(signedTx)
    return bs58.encode(txHash)
  }
}

export class NearChain extends Chain {
  near: Near = null!
  account: AsyncAccount = null!
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
    self.account = new AsyncAccount(self.near.connection, config.relayerAccountId)
    // this.poolContract = new Contract(this.account, config.poolContractId, {
    //   changeMethods: ['transact', 'lock', 'release'],
    //   viewMethods: ['pool_index', 'merkle_root'],
    // })

    self.denominator = new BN('1000000000000000')

    return self
  }

  public async processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number }> {
    const { amount, txProof, txType, rawMemo, extraData } = tx

    const logPrefix = `Job ${id}:`

    logger.info(`${logPrefix} Received ${txType} tx with ${amount} native amount`)

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

    const extraDataBuf = extraData ? Buffer.from(extraData, 'hex') : null

    const calldata: PoolCalldata = new PoolCalldata({
      nullifier: new BN(txProof.inputs[1]),
      outCommit: new BN(treeProof.inputs[2]),
      tokenId: this.config.tokenId,
      delta: new BN(txProof.inputs[3]),
      transactProof: flattenProof(txProof.proof),
      rootAfter: new BN(treeProof.inputs[1]),
      treeProof: flattenProof(treeProof.proof),
      txType: numTxType,
      memo: Buffer.from(rawMemo, 'hex'),
      extraData: extraDataBuf,
    })

    const bin = serializePoolData(calldata)
    const data = Buffer.from(bin).toString('base64')

    return { data, commitIndex }
  }

  prepareTxForStorage(outCommit: BN, hash: string, memo: string): string {
    // Store hash as hex
    const hexHash = Buffer.from(bs58.decode(hash)).toString('hex');
    return numToHex(outCommit).concat(hexHash).concat(memo)
  }

  parseCalldata(tx: string): PoolCalldata {
    return deserializePoolData(Buffer.from(tx, 'base64'));
  }

  async getTxStatus(txId: any): Promise<{ status: TxStatus, blockId?: any, error?: string }> {
    const provider = this.near.connection.provider

    let result
    try {
      result = await provider.txStatus(txId, this.account.accountId)
    } catch (err: any) {
      return { status: TxStatus.FatalError, error: err.toString() }
    }

    let status, error

    switch (result.status) {
      case FinalExecutionStatusBasic.Failure:
        status = TxStatus.FatalError;
        break
      case FinalExecutionStatusBasic.NotStarted:
      case FinalExecutionStatusBasic.Started:
        status = TxStatus.Pending;
        break
      default: {
        if (typeof result.status.SuccessValue !== 'undefined') {
          status = TxStatus.Mined
        } else if (typeof result.status.Failure !== 'undefined') {
          if (['InvalidNonce', 'Expired'].includes(result.status.Failure.error_type)) {
            status = TxStatus.RecoverableError
          } else {
            status = TxStatus.FatalError
          }
          error = result.status.Failure.error_message
        } else {
          status = TxStatus.FatalError
          error = 'Unknown error'
        }
      }
    }

    const res = {
      status,
      blockId: result.transaction,
      error,
    }

    return res
  }

  async getTx(txId: string): Promise<any> {
    const provider = new providers.JsonRpcProvider({ url: 'https://archival-rpc.testnet.near.org' });
    const tx = await provider.txStatus(txId, this.config.relayerAccountId);
    // @ts-ignore block_hash is not present in the type definition even though it is in the response.
    const block = await provider.block({ blockId: tx.transaction_outcome.block_hash });

    const action = tx.transaction.actions.find((a: any) => !!a['FunctionCall'] && a['FunctionCall'].method_name == 'transact');
    if (!action) {
      throw new Error('No transact action found');
    }

    const args = action['FunctionCall'].args;

    return {
      hash: tx.transaction.hash,
      block_hash: block.header.hash,
      block_height: block.header.height,
      timestamp: Number(block.header.timestamp_nanosec),
      sender_address: tx.transaction.signer_id,
      receiver_address: tx.transaction.receiver_id,
      signature: tx.transaction.signature,
      calldata: args,
    }
  }

  // For near, use block time
  async getLatestBlockId(): Promise<number> {
    const status = await this.near.connection.provider.status()
    return status.sync_info.latest_block_height
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
    logger.debug('Signing and sending tx: %o', txConfig)

    // const hash = await this.account.functionCallCustom(
    //   this.config.poolContractId,
    //   'transact',
    //   Buffer.from(txConfig.data, 'base64'),
    //   MAX_GAS,
    //   new BN(0),
    // )

    // logger.debug('Transaction hash: %o', hash)

    // return hash

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

  extractCiphertextFromTx(memo: string, txType: TxType): string {
    let offset = 0;
    switch (txType) {
      case TxType.DEPOSIT:
      case TxType.TRANSFER: {
        offset = 16;
        break;
      }
      case TxType.PERMITTABLE_DEPOSIT: {
        offset = 72;
        break;
      }
      case TxType.WITHDRAWAL: {
        offset = 32;
        const reader = new BinaryReader(Buffer.from(memo.slice(offset), 'hex'))
        const addrLength = reader.readU32()
        offset += 8 + addrLength * 2
      }
    }

    return memo.slice(offset)
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
