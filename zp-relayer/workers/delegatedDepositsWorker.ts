
import type { AbiItem } from 'web3-utils';
import { Queue, Worker } from 'bullmq';
import { web3 } from '../services/web3'
import ddAbi from '../abi/delegated-deposit-storage.json'
import config from '../config'
import { logger } from '../services/appLogger'
import { DelegatedDeposit, DelegatedDepositsData, FullDelegatedDeposit, Params, Proof } from 'libzeropool-rs-node'
import { pool } from '../pool';
import { TxType } from 'zp-memo-parser';
import { ddParams, txParams } from '../prover';
import { getEvents } from '../utils/web3';
import { readLatestDDBlock, RelayerKeys, updateField } from '../utils/redisFields';
import { Mutex } from 'async-mutex';


class DepositCreateEvent {
  id: string = ''
  owner: string = ''
  receiver_d: string = ''
  receiver_p: string = ''
  denominated_amount: string = ''
  denominated_fee: string = ''
  expired: string = ''

  constructor(values: object) {
    Object.assign(this, values)
  }

  toFullDelegatedDeposit(): FullDelegatedDeposit {
    return {
      id: this.id,
      owner: this.owner,
      receiver_d: web3.utils.hexToNumberString(this.receiver_d),
      receiver_p: web3.utils.hexToNumberString(this.receiver_p),
      denominated_amount: this.denominated_amount,
      denominated_fee: this.denominated_fee,
      expired: this.expired,
    }
  }
}

// Naive implementation of the worker
// Implement a proper queue and job aggregation/batching for production
export async function createDelegatedDepositsWorker() {
  const contract = new web3.eth.Contract(ddAbi as AbiItem[], config.delegatedDepositsAddress)

  // An async lock would suffice here since there is no multithreading here, but I'm using a mutex for consistency
  let bufferMutex = new Mutex()
  let depositsBuffer: FullDelegatedDeposit[] = []

  // Listen to the DepositCreate events and aggregate deposits
  setTimeout(async () => {
    let latestBlock = parseInt(await readLatestDDBlock() || '0')

    logger.info("Starting delegated deposits listener from block", latestBlock)

    while (true) {
      try {
        const events = await getEvents(contract, 'DepositCreate', { fromBlock: latestBlock + 1, toBlock: 'latest' })

        for (const event of events) {
          const depositEvent = new DepositCreateEvent(event.returnValues)
          const deposit = depositEvent.toFullDelegatedDeposit()
          const contractDeposit = await contract.methods.deposits(deposit.id).call();

          if (contractDeposit.owner === '0x0000000000000000000000000000000000000000') {
            logger.debug(`Skipping spent deposit: ${deposit.id}`)
            continue
          } else {
            logger.info(`Found unspent deposit: ${deposit.id}`)
          }

          if (event.blockNumber > latestBlock) {
            await bufferMutex.runExclusive(() => {
              depositsBuffer.push(deposit)
            })
          }

          if (event.blockNumber > latestBlock) {
            await updateField(RelayerKeys.LATEST_DD_BLOCK, event.blockNumber.toString())
          }

          latestBlock = event.blockNumber
        }
      } catch (err) {
        logger.error(`Error while listening to the DepositCreate events: ${err}`, err)
      }

      await new Promise(resolve => setTimeout(resolve, config.delegatedDepositsCheckInterval))
    }
  }, 1)

  // Take deposits, form a transaction and send it to the queue
  setTimeout(async () => {
    while (true) {
      if (depositsBuffer.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 500))
        continue
      }

      await new Promise(resolve => setTimeout(resolve, config.delegatedDepositsFlushInterval))

      const release = await bufferMutex.acquire()
      try {
        logger.info(`Sending ${depositsBuffer.length} delegated deposits to the queue`)

        const dd = await await DelegatedDepositsData.create(depositsBuffer)
        const proof = await Proof.delegatedDepositAsync(ddParams, dd.public, dd.secret)
        const tx = {
          txType: TxType.DELEGATED_DEPOSIT,
          memo: dd.memo.toString('hex'),
          extraData: null,
          proof,
          delegatedDeposit: dd,
        }

        await pool.transact([tx])

        depositsBuffer = []
      } catch (err) {
        logger.error("Error while sending deposits to the queue:", err)
      } finally {
        release()
      }
    }
  }, 1)
}
