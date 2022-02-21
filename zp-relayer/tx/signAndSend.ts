import BN from 'bn.js'
import { ApiPromise } from '@polkadot/api'
import { keypair } from '../services/polkadot'
import { logger } from '../services/appLogger'


export async function signAndSend(
  data: string,
  api: ApiPromise,
): Promise<string> {
  const tx = api.tx.zeropool.transact(data)
  const { partialFee, weight } = await tx.paymentInfo(keypair);

  logger.info(`Transaction weight: ${weight}, weight fees ${partialFee.toHuman()}`)

  return await tx
    .signAndSend(keypair)
    .toString()
}
