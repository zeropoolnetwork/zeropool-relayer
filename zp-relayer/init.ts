import { pool } from './pool'
import { GasPrice } from './services/GasPrice'
import { web3 } from './services/web3'
import config from './config'

import { createPoolTxWorker } from './poolTxWorker'
import { createSentTxWorker } from './sentTxWorker'

export async function init() {
  await pool.init()
  const gasPriceService = new GasPrice(web3, config.gasPriceUpdateInterval, config.gasPriceEstimationType, {})
  await gasPriceService.start()
  ;(await createPoolTxWorker(gasPriceService)).run()
  ;(await createSentTxWorker(gasPriceService)).run()
}
