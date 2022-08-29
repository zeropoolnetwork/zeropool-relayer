import { connect, keyStores, KeyPair, WalletConnection, Near, Contract } from 'near-api-js'
import { FinalExecutionStatusBasic } from 'near-api-js/lib/providers'
import connectPg from 'pg-promise'
import borsh from 'borsh'
import BN from 'bn.js'
import { TxType } from 'zp-memo-parser'

import { Chain, MessageEvent, TxStatus, PoolCalldata } from './chain'
import { readLatestCheckedBlock, RelayerKeys, updateField } from '../utils/redisFields'
import config from '../config'
import { logger } from '../services/appLogger'
import { TxPayload } from '../services/poolTxQueue'
import { Pool } from '../pool'
import { parseDelta } from '../validateTx'
import { Proof, SnarkProof } from 'libzkbob-rs-node'


const BORSH_SCHEMA = new Map([[
  PoolCalldata,
  {
    kind: 'struct',
    fields: [
      ['nullifier', 'u256'],
      ['outCommit', 'u256'],
      ['transferIndex', 'u256'],
      ['energyAmount', 'u256'],
      ['tokenAmount', 'u256'],
      ['delta', 'u256'],

      ['transactionProof', ['u256', 8]],
      ['rootAfter', 'u256'],
      ['treeProof', ['u256', 8]],

      ['txType', 'u16'],

      ['memo', []],
      ['depositAddress', 'string'],
    ]
  }
]])

export class NearChain implements Chain {
  near: Near
  walletConnection: WalletConnection
  poolContract: Contract
  indexer: any

  constructor() {
    this.walletConnection = null!
    this.near = null!
    this.poolContract = null!
  }

  public async processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number }> {
    const { amount, txProof, txType, rawMemo, depositSignature } = tx

    const logPrefix = `Job ${id}:`

    logger.info(`${logPrefix} Recieved ${txType} tx with ${amount} native amount`)

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
      case TxType.WITHDRAW: numTxType = 2; break
      default: throw new Error(`Unsupported tx type: ${txType}`)
    }

    const calldata: PoolCalldata = {
      nullifier: new BN(txProof.inputs[1]),
      outCommit: new BN(treeProof.inputs[2]),
      transferIndex: delta.transferIndex,
      energyAmount: delta.energyAmount,
      tokenAmount: delta.tokenAmount,
      delta: new BN(txProof.inputs[3]),
      transactProof: flattenProof(txProof.proof),
      rootAfter: new BN(treeProof.inputs[1]),
      treeProof: flattenProof(treeProof.proof),
      txType: numTxType,
      memo: Buffer.from(rawMemo, 'hex'),
      depositAddress: depositSignature || ''
    }

    const data = Buffer.from(borsh.serialize(BORSH_SCHEMA, calldata)).toString('base64')

    return { data, commitIndex }
  }

  parseCalldata(tx: string): PoolCalldata {
    return borsh.deserialize(BORSH_SCHEMA, PoolCalldata, Buffer.from(tx, 'base64'));
  }

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

    const nearConnection = await connect(connectionConfig)
    this.near = nearConnection
    this.walletConnection = new WalletConnection(nearConnection, null)
    this.poolContract = new Contract(this.walletConnection.account(), config.poolAddress!, {
      changeMethods: ['transact', 'reserve', 'release'],
      viewMethods: ['pool_index'],
    })
    const pgConn = connectPg()
    this.indexer = pgConn(config.nearIndexerUrl!)
  }

  async getTxStatus(txId: any): Promise<{ status: TxStatus, blockId?: any }> {
    const provider = this.near.connection.provider
    const result = await provider.txStatus(txId, this.walletConnection.getAccountId())
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
      const fromBlock = Number(await readLatestCheckedBlock())
      const lastBlock = (await this.near.connection.provider.status()).sync_info.latest_block_time;

      const txs: any[] = await this.indexer.any(`
        SELECT tx.transaction_hash, tx.block_timestamp, tx.receiver_account_id, tx.signature, a.args
          FROM transactions AS tx
          JOIN transaction_actions AS a ON tx.transaction_hash = a.transaction_hash
          WHERE tx.receiver_account_id = $1 AND a.action_kind = "FUNCTION_CALL" AND tx.block_timestamp > $2
          ORDER BY tx.block_timestamp ASC
      `, [config.poolAddress, fromBlock]);

      const events: MessageEvent[] = txs.reduce(async (acc, tx: any) => {
        if (tx.args.method_name === 'transact') {
          acc.push({
            transactionHash: tx.transactionHash,
            data: tx.args.args_base64,
          })
        }

        return acc;
      }, [])

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
    return await this.poolContract.pool_index()
  }

  async getContractMerkleRoot(index: string | null | undefined): Promise<string> {
    // @ts-ignore
    return await this.poolContract.merkle_root(index || '0')
  }

  async signAndSend(txConfig: { data: string, nonce: string, gas: string, amount: string }): Promise<string> {
    // @ts-ignore
    return await this.poolContract.transact({
      args: txConfig.data,
    });
  }

  async getDenominator(): Promise<string> {
    return '1' // TODO
  }
}

export function flattenProof(p: SnarkProof): BN[] {
  return [p.a, p.b.flat(), p.c]
    .flat()
    .map(n => new BN(n))
}
