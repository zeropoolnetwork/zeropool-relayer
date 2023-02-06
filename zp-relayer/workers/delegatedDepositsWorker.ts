
import type { AbiItem } from 'web3-utils';
import { web3 } from '../services/web3'
import * as ddAbi from '../abi/delegated-deposit-storage.json'
import config from '../config'
import { logger } from '../services/appLogger'
import { DelegatedDeposit, DelegatedDepositData, FullDelegatedDeposit, Params, Proof } from 'libzeropool-rs-node'
import { pool } from '../pool';
import { TxType } from 'zp-memo-parser';
import { ddParams, txParams } from '../prover';


class DepositCreateEvent {
  id: string = ''
  owner: string = ''
  receiver_d: string = ''
  receiver_p: string = ''
  denominated_amount: string = ''
  denominated_fee: string = ''
  expired: string = ''

  toFullDelegatedDeposit(): FullDelegatedDeposit {
    return {
      id: web3.utils.hexToNumberString(this.id),
      owner: this.owner,
      receiver_d: web3.utils.hexToNumberString(this.receiver_d),
      receiver_p: web3.utils.hexToNumberString(this.receiver_p),
      denominated_amount: web3.utils.hexToNumberString(this.denominated_amount),
      denominated_fee: web3.utils.hexToNumberString(this.denominated_fee),
      expired: web3.utils.hexToNumberString(this.expired),
    }
  }
}

// Naive implementation of the worker
// Implement a proper queue for production
export async function createDelegatedDepositsWorker() {
  const contract = new web3.eth.Contract(ddAbi as AbiItem[], config.delegatedDepositsAddress)
  let depositsBuffer: FullDelegatedDeposit[] = []

  let subscription = contract.events.DepositCreate({ fromBlock: 0 })
    .on('data', (event: DepositCreateEvent) => {
      logger.info("New DepositCreate event:", event)
      const deposit = event.toFullDelegatedDeposit()

      depositsBuffer.push(deposit)
    })
    .on('changed', (changed: any) => logger.info(changed))
    .on('error', (err: any) => {
      logger.error("Error while listening to delegated deposits:", err)
    })
    .on('connected', (str: any) => logger.info("Connected to DepositCreate event:", str))

  setInterval(async () => {
    if (depositsBuffer.length > 0) {
      logger.info("Sending deposits to the queue:", depositsBuffer)

      const root = pool.optimisticState.getMerkleRoot()
      const dd = await DelegatedDepositData.create(depositsBuffer, root, '0', ddParams)
      const proof = await Proof.txAsync(txParams, dd.tx_public, dd.tx_secret)
      const tx = {
        txType: TxType.DELEGATED_DEPOSIT,
        memo: dd.memo.toString('hex'),
        depositSignature: null,
        proof,
      }

      pool.transact([tx])

      depositsBuffer = []
    }
  }, config.delegatedDepositsFlushInterval)

  return subscription
}
