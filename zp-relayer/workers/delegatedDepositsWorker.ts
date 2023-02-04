
import type { AbiItem } from 'web3-utils';
import { web3 } from '../services/web3'
import * as ddAbi from '../abi/delegated-deposit-storage.json'
import { poolTxQueue } from '../queue/poolTxQueue'
import config from '../config'
import { logger } from '../services/appLogger'
import { DelegatedDeposit, DelegatedDepositData, Params, Proof } from 'libzeropool-rs-node'
import { pool } from '../pool';
import { TxType } from 'zp-memo-parser';



interface DepositCreateEvent {
  id: string
  owner: string
  receiver_d: string
  receiver_p: string
  denominated_amount: string
  denominated_fee: string
  expired: string
}

// Naive implementation of the worker
export async function createDelegatedDepositsWorker() {
  const params = Params.fromFile(config.delegatedDepositParamsPath)
  const contract = new web3.eth.Contract(ddAbi as AbiItem[], config.delegatedDepositsAddress)
  let depositsBuffer: DelegatedDeposit[] = []

  let subscription = contract.events.DepositCreate({ fromBlock: 0 })
    .on('data', (event: DepositCreateEvent) => {
      logger.info("New DepositCreate event:", event)

      const fee = web3.utils.toBN(event.denominated_fee)
      const amount = web3.utils.toBN(event.denominated_amount)
      const b = fee.sub(amount)

      const deposit: DelegatedDeposit = {
        d: event.receiver_d,
        p_d: event.receiver_p,
        b: b.toString(),
      }

      depositsBuffer.push(deposit)
    })
    .on('changed', (changed: any) => logger.info(changed))
    .on('error', (err: any) => {
      logger.error("Error while listening to delegated deposits:", err)
    })
    .on('connected', (str: any) => logger.info("Connected to delegated deposits:", str))

  setInterval(async () => {
    if (depositsBuffer.length > 0) {
      logger.info("Sending deposits to the queue:", depositsBuffer)

      const dd = new DelegatedDepositData(depositsBuffer)
      const proof = await Proof.delegatedDepositAsync(params, dd.public, dd.secret)
      const tx = {
        txType: TxType.DELEGATED_DEPOSIT,
        proof,
        memo: dd.memo.toString('hex'),
        depositSignature: null,
      }

      pool.transact([tx])

      depositsBuffer = []
    }
  }, config.delegatedDepositsFlushInterval)

  return subscription
}
