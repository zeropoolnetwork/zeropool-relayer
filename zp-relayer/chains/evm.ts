import Web3 from 'web3'
import { Contract, PastEventOptions } from 'web3-eth-contract'
import { AbiItem, toBN } from 'web3-utils'

import BN from 'bn.js'

import PoolAbi from '../abi/pool-abi.json'
import { MessageEvent, Chain, TxStatus, PoolCalldata } from './chain'
import config from '../config'
import { logger } from '../services/appLogger'
import { Pool } from '../pool'
import { TxPayload } from '../queue/poolTxQueue'

export class EvmChain implements Chain {
  web3: Web3
  contract: Contract
  public chainId: number = 0
  public denominator: BN = toBN(1)
  public isInitialized = false

  constructor() {
    this.web3 = new Web3(config.rpcUrl)
    this.contract = new this.web3.eth.Contract(PoolAbi as AbiItem[], config.poolAddress)
  }
  processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number }> {
    throw new Error('Method not implemented.')
  }

  parseCalldata(tx: string): PoolCalldata {
    throw new Error('Method not implemented.')
  }

  async init(): Promise<void> { }

  async getTxStatus(txHash: any): Promise<{ status: TxStatus, blockId?: any }> {
    const tx = await this.web3.eth.getTransactionReceipt(txHash)
    let status, blockId;
    if (tx) {
      if (tx.status) {
        blockId = tx.blockNumber
        status = TxStatus.Mined
      } else {
        status = TxStatus.Error
      }
    } else {
      status = TxStatus.Missing
    }

    return {
      status
    }
  }

  async getDenominator(): Promise<string> {
    return await this.contract.methods.denominator().call()
  }

  async getNewEvents(): Promise<MessageEvent[]> {
    throw new Error('unimplemented')
  }

  async signAndSend(tx: any): Promise<string> {
    const serializedTx = await this.web3.eth.accounts.signTransaction(tx, config.relayerPrivateKey)

    return new Promise((res, rej) =>
      this.web3.eth
        .sendSignedTransaction(serializedTx.rawTransaction as string)
        .once('transactionHash', res)
        .once('error', rej)
    )
  }

  async getContractTransferNum(): Promise<string> {
    const transferNum = await this.contract.methods.pool_index().call()
    return transferNum
  }

  async getContractMerkleRoot(index: string | number | undefined | null): Promise<string> {
    if (!index) {
      index = await this.contract.methods.pool_index().call()
    }
    const root = await this.contract.methods.roots(index).call()
    return root.toString()
  }
}

export async function getNonce(web3: Web3, address: string) {
  try {
    logger.debug(`Getting transaction count for ${address}`)
    const transactionCount = await web3.eth.getTransactionCount(address)
    logger.debug(`Transaction count obtained for ${address}: ${transactionCount}`)
    return transactionCount
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error(`Nonce cannot be obtained`)
  }
}

export async function getEvents(contract: Contract, event: string, options: PastEventOptions) {
  try {
    const contractAddress = contract.options.address
    logger.info(
      '%o, Getting past events',
      { contractAddress, event, fromBlock: options.fromBlock, toBlock: options.toBlock }
    )
    const pastEvents = await contract.getPastEvents(event, options)
    logger.debug('%o, Past events obtained', { contractAddress, event, count: pastEvents.length })
    return pastEvents
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error(`${event} events cannot be obtained`)
  }
}

export async function getTransaction(web3: Web3, hash: string) {
  try {
    logger.info(`Getting tx ${hash}`)
    const tx = await web3.eth.getTransaction(hash)
    logger.debug(`Got tx ${hash}`)
    return tx
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error(`${hash} tx cannot be obtained`)
  }
}

export async function getChainId(web3: Web3) {
  try {
    logger.debug('Getting chain id')
    const chainId = await web3.eth.getChainId()
    logger.debug(`Chain id obtained ${chainId}`)
    return chainId
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error('Chain Id cannot be obtained')
  }
}
