import Web3 from 'web3'
import { Contract, PastEventOptions } from 'web3-eth-contract'
import { AbiItem, toBN, toWei } from 'web3-utils'

import BN from 'bn.js'

import PoolAbi from './pool-abi.json'
import {
  checkDeadline,
  checkFee,
  checkNativeAmount,
  checkSize,
  checkTxProof,
  checkTxSpecificFields,
} from '../../validateTx'
import { MessageEvent, Chain, TxStatus, PoolCalldata } from '../chain'
import config from '../../config'
import { logger } from '../../services/appLogger'
import { Pool, PoolTx } from '../../pool'
import { TxPayload } from '../../queue/poolTxQueue'
import { getTxData, PermittableDepositTxData, TxData, TxType, WithdrawTxData } from 'zp-memo-parser';
import { parseDelta } from '../../validateTx';
import { checkAssertion, numToHex, unpackSignature } from '../../utils/helpers';
import { web3 } from '../../services/web3';
import TokenAbi from './token-abi.json';
import { recoverSaltedPermit } from '../../utils/EIP712SaltedPermit';
import { ZERO_ADDRESS } from '../../utils/constants'
import {  } from '../../utils/web3'

export class EvmChain extends Chain {
  web3: Web3 = null!
  contract: Contract = null!
  public chainId: number = 0
  public denominator: BN = new BN(1)

  processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number }> {
    throw new Error('Method not implemented.')
  }

  parseCalldata(tx: string): PoolCalldata {
    throw new Error('Method not implemented.')
  }

  static async create(): Promise<EvmChain> {
    const self = new EvmChain()
    self.web3 = new Web3(config.rpcUrl)
    self.contract = new self.web3.eth.Contract(PoolAbi as AbiItem[], config.poolAddress)
    // FIXME: init denominator
    return self
  }

  async validateTx({ txType, proof, memo }: PoolTx): Promise<void> {
    const buf = Buffer.from(memo, 'hex')
    const txData = getTxData(buf, txType)

    await checkAssertion(() => checkFee(txData.fee))

    if (txType === TxType.WITHDRAWAL) {
      const nativeAmount = (txData as WithdrawTxData).nativeAmount
      await checkAssertion(() => checkNativeAmount(nativeAmount))
    }

    await checkAssertion(() => checkTxProof(proof))

    const delta = parseDelta(proof.inputs[3])

    const tokenAmountWithFee = delta.tokenAmount.add(txData.fee)
    await checkAssertion(() => checkTxSpecificFields(txType, tokenAmountWithFee, delta.energyAmount, txData, toBN('0')))

    const requiredTokenAmount = tokenAmountWithFee.mul(this.denominator)
    let userAddress = ZERO_ADDRESS
    if (txType === TxType.DEPOSIT || txType === TxType.PERMITTABLE_DEPOSIT) {
      throw new Error('unimplemented, extract depositSignature from memo');
      // userAddress = await this.getRecoveredAddress(txType, proof.inputs[1], txData, requiredTokenAmount, depositSignature)
      // await checkAssertion(() => checkDepositEnoughBalance(userAddress, requiredTokenAmount))
    }
  }

  private async getRecoveredAddress(
    txType: TxType,
    proofNullifier: string,
    txData: TxData,
    tokenAmount: BN,
    depositSignature: string | null
  ) {
    const tokenContract = new web3.eth.Contract(TokenAbi as AbiItem[], config.tokenAddress)
    // Signature without `0x` prefix, size is 64*2=128
    await checkAssertion(() => {
      if (depositSignature !== null && checkSize(depositSignature, 128)) return null
      return new Error('Invalid deposit signature')
    })
    const nullifier = '0x' + numToHex(toBN(proofNullifier))
    const sig = unpackSignature(depositSignature as string)

    let recoveredAddress: string
    if (txType === TxType.DEPOSIT) {
      recoveredAddress = web3.eth.accounts.recover(nullifier, sig)
    } else if (txType === TxType.PERMITTABLE_DEPOSIT) {
      const { deadline, holder } = txData as PermittableDepositTxData
      const owner = web3.utils.toChecksumAddress(web3.utils.bytesToHex(Array.from(holder)))
      const spender = web3.utils.toChecksumAddress(config.poolAddress as string)
      const nonce = await tokenContract.methods.nonces(owner).call()

      const message = {
        owner,
        spender,
        value: tokenAmount.toString(10),
        nonce,
        deadline: deadline.toString(10),
        salt: nullifier,
      }
      recoveredAddress = recoverSaltedPermit(message, sig)

      await checkAssertion(() => checkDeadline(deadline))
    } else {
      throw new Error('Unsupported txtype')
    }

    return recoveredAddress
  }

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

  async getEvents(): Promise<MessageEvent[]> {
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
    return await this.contract.methods.pool_index().call()
  }

  async getContractMerkleRoot(index: string | number | undefined | null): Promise<string> {
    if (!index) {
      index = await this.contract.methods.pool_index().call()
    }
    const root = await this.contract.methods.roots(index).call()
    return root.toString()
  }

  fromBaseUnit(amount: BN): BN {
    return toWei(amount)
  }

  toBaseUnit(amount: BN): BN {
    return toWei(amount)
  }

  getLatestBlockId(): Promise<number> {
    return Promise.resolve(0);
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

async function checkBalance(address: string, minBalance: string) {
  const tokenContract = new web3.eth.Contract(TokenAbi as AbiItem[], config.tokenAddress)
  const balance = await tokenContract.methods.balanceOf(address).call()
  const res = toBN(balance).gte(toBN(minBalance))
  if (!res) {
    return new Error('Not enough balance for deposit')
  }
  return null
}



async function checkDepositEnoughBalance(address: string, requiredTokenAmount: BN) {
  if (requiredTokenAmount.lte(toBN(0))) {
    throw new Error('Requested balance check for token amount <= 0')
  }

  return checkBalance(address, requiredTokenAmount.toString(10))
}
