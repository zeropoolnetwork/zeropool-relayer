import BN from 'bn.js'
import bs58 from 'bs58'
import { broadcast, invokeScript, nodeInteraction } from "@waves/waves-transactions";
import { logger } from '../services/appLogger'
import { readLatestCheckedBlock, RelayerKeys, updateField } from '../utils/redisFields'
import { MessageEvent, Chain, TxStatus, PoolCalldata } from './chain';
import { Pool } from '../pool';
import { TxPayload } from '../queue/poolTxQueue';
import { TxType } from 'zp-memo-parser';
import { BinaryReader, BinaryWriter } from '../utils/binary';
import { Proof, SnarkProof } from 'libzkbob-rs-node'
import { Seed } from '@waves/waves-transactions/dist/seedUtils';

// const topic = blake2AsHex('ZeropoolMessage')

const {
  RPC_URL,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as { [key: PropertyKey]: string }



export interface WavesConfig {
  nodeUrl: string
  chainId: string
  poolAddress: string
  assetId: string
  seed: string
}

export class WavesChain extends Chain {
  constructor(private config: WavesConfig, private account: Seed) {
    super()
  }

  static async create(config: WavesConfig): Promise<WavesChain> {
    const seed = new Seed(config.seed, config.chainId)
    const self = new WavesChain(config, seed)
    self.config = config
    self.account = seed
    return self
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

  toBaseUnit(amount: BN): BN {
    return amount.mul(new BN(10000000))
  }

  fromBaseUnit(amount: BN): BN {
    return amount.div(new BN(10000000))
  }

  async processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number; }> {
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
      tokenId: this.config.assetId,
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

  parseCalldata(tx: string): PoolCalldata {
    const reader = new BinaryReader(Buffer.from(tx, 'hex'), 'be')

    // # nullifier          32 bytes
    // # outCommit         32 bytes
    // # assetId           32 bytes
    // # delta             32 bytes
    // #     nativeAmount   8 bytes
    // #     nativeEnergy  14 bytes
    // #     txIndex        6 bytes
    // #     poolId         3 bytes
    // # txProof          256 bytes
    // # treeProof        256 bytes
    // # rootAfter         32 bytes
    // # txType             2 bytes
    // # memo               dynamic bytes
    // # depositPk          optional 32 bytes
    // # depositSignature   optional 64 bytes

    const nullifier = reader.readU256()
    const outCommit = reader.readU256()
    const assetId = reader.readBuffer(32)
    const delta = reader.readU256()
    const transactProof = reader.readFixedArray(8, () => reader.readU256())
    const treeProof = reader.readFixedArray(8, () => reader.readU256())
    const rootAfter = reader.readU256()
    const txType = reader.readU16()

    const memoData = reader.readBufferUntilEnd()!
    const memo = memoData.slice(0, -(64 + 32))
    const extraData = memoData.slice(-(64 + 32))

    const tokenId = bs58.encode(assetId)

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

  async getTxStatus(txId: string): Promise<{ status: TxStatus; blockId?: any; }> {
    const url = new URL(`/transactions/info/${txId}`, this.config.nodeUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch tx ${txId}: ${res.statusText}`);
    }

    const json = await res.json();

    if (json.call.function != 'transact') {
      throw new Error(`Non-pool transaction: ${json}`);
    }

    return {
      status: TxStatus.Mined
    }
  }

  async signAndSend(txConfig: { data: string, nonce: string, gas: string, amount: string }): Promise<string> {
    const res = await broadcast(invokeScript({
      dApp: this.config.poolAddress,
      call: {
        function: 'deposit',
        args: [
          { type: 'binary', value: txConfig.data },
        ]
      },
    }, this.account.keyPair), this.config.nodeUrl)

    return res.id
  }

  // async getEvents(): Promise<MessageEvent[]> {
  //   throw new Error('Method not implemented.')
  // }

  async getContractTransferNum(): Promise<string> {
    const res = await nodeInteraction.accountDataByKey('PoolIndex', this.config.poolAddress, this.config.nodeUrl);

    if (!res) {
      return '0'
    }

    switch (res.type) {
      case 'integer':
        return res.value.toString()
      case 'string':
        return res.value
      default:
        throw new Error('Incorrect PoolIndex type')
    }
  }

  async getContractMerkleRoot(index: string | null | undefined): Promise<string> {
    const res = await nodeInteraction.accountDataByKey(`R:${index}`, this.config.poolAddress, this.config.nodeUrl);

    if (!res) {
      throw new Error('Merkle root not found')
    }

    if (res.type == 'string') {
      const buf = Buffer.from(res.value, 'base64')
      const bn = new BN(buf, 10, 'be')
      return bn.toString()
    } else {
      throw new Error('Incorrect Merkle root type')
    }
  }

  getLatestBlockId(): Promise<number> {
    return Promise.resolve(0);
  }

}

export async function initWaves() {

}

export function flattenProof(p: SnarkProof): BN[] {
  return [p.a, p.b.flat(), p.c]
    .flat()
    .map(n => new BN(n))
}

function serializePoolData(data: PoolCalldata): Buffer {
  const writer = new BinaryWriter('be')

  writer.writeU256(data.nullifier)
  writer.writeU256(data.outCommit)
  writer.writeBuffer(Buffer.from(bs58.decode(data.tokenId)))
  writer.writeU256(data.delta)
  for (let element of data.transactProof) {
    writer.writeU256(element)
  } for (let element of data.treeProof) {
    writer.writeU256(element)
  }
  writer.writeU256(data.rootAfter)
  writer.writeU16(data.txType)
  writer.writeBuffer(Buffer.from(data.memo))
  if (data.extraData) {
    writer.writeFixedArray(data.extraData)
  }

  return Buffer.from(writer.toArray())
}
