import connectPg from 'pg-promise';
import { logger } from '../../services/appLogger';

const PG_NUM_RETRIES = 100
const PG_RETRY_DELAY_MS = 3000

export type NearTransaction = {
  transaction_hash: string,
  block_timestamp: number,
  receiver_account_id: string,
  signature: string,
  status: string,
  args: {
    method_name: string,
    args_base64: string,
  }
}

export class NearIndexerApi {
  contractTimestamp: number = null!
  db: any = null!
  poolAddress: string = null!

  public static async create(url: string, poolAddress: string): Promise<NearIndexerApi> {
    const self = new NearIndexerApi()

    self.poolAddress = poolAddress

    logger.info('Connecting to near indexer...')
    const pgConn = connectPg()
    self.db = pgConn(url)

    logger.info('Receiving contract publication date...')
    // Ignore before-redeploy transactions for now.
    const timestamp = await retry(async () => {
      const result = await self.db.one(`
          SELECT tx.block_timestamp, tx.receiver_account_id, a.args
          FROM transactions AS tx
          JOIN transaction_actions AS a ON tx.transaction_hash = a.transaction_hash
          WHERE tx.receiver_account_id = $1 AND a.action_kind = 'FUNCTION_CALL' AND a.args->>'method_name' = 'new'
          ORDER BY tx.block_timestamp DESC
          LIMIT 1
      `, [poolAddress])

      return result.block_timestamp
    })

    self.contractTimestamp = Number(timestamp)

    return self
  }

  async getTransactions(startingFrom?: number | BigInt): Promise<NearTransaction[]> {
    return await retry(() => this.db.manyOrNone(`
        SELECT tx.transaction_hash, tx.block_timestamp, tx.receiver_account_id, tx.signature, tx.status, a.args
          FROM transactions AS tx
          JOIN transaction_actions AS a ON tx.transaction_hash = a.transaction_hash
          WHERE tx.receiver_account_id = $1 AND a.action_kind = 'FUNCTION_CALL' AND tx.block_timestamp > $2 AND a.args->>'method_name' = 'transact'
          ORDER BY tx.block_timestamp ASC
      `, [this.poolAddress, startingFrom || this.contractTimestamp])
    )
  }
}

function retry<T>(fn: () => Promise<T>, retries: number = PG_NUM_RETRIES, delay: number = PG_RETRY_DELAY_MS): Promise<T> {
  return fn().catch(async err => {
    if (retries > 0) {
      logger.warn(`Attempt failed, retrying ${retries} more times...`, err)
      await new Promise(resolve => setTimeout(resolve, delay))
      return retry(fn, retries - 1)
    } else {
      throw err
    }
  })
}