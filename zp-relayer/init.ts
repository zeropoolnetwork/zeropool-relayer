import { initPool } from './pool'
import { GasPrice } from './services/GasPrice'
import { web3 } from './services/web3'
import config from './config'
import { Mutex } from 'async-mutex'

import { createPoolTxWorker } from './workers/poolTxWorker'
import { createSentTxWorker } from './workers/sentTxWorker'
// import { initializeDomain } from './utils/EIP712SaltedPermit'

export async function init() {
  let gasPriceService = null
  if (config.chain == 'evm') {
    // await initializeDomain(web3)
    gasPriceService = new GasPrice(web3, config.gasPriceUpdateInterval, config.gasPriceEstimationType, {})
    await gasPriceService.start()
  }

  await initPool()

  const workerMutex = new Mutex();
  const poolTxWorker = await createPoolTxWorker(workerMutex, gasPriceService)
  poolTxWorker.run()
  const sendTxWorker = await createSentTxWorker(workerMutex, gasPriceService)
  sendTxWorker.run()
}
