import BN from 'bn.js'
import { ApiPromise } from '@polkadot/api'
import { keypair } from '../services/polkadot'
import { logger } from '../services/appLogger'


export async function signAndSend(
  data: string,
  api: ApiPromise,
): Promise<string> {
  logger.info(`Transactoin data: \n${data}`)
  const tx = api.tx.zeropool.transact(data)
  const { partialFee, weight } = await tx.paymentInfo(keypair);

  logger.info(`Transaction weight: ${weight}, weight fees ${partialFee.toHuman()}`)

  return await new Promise((res, rej) => {
    tx
      .signAndSend(keypair, { nonce: -1 }, ({ txHash, status }) => {
        if (status.isFinalized) {
          console.log('Finalized block hash', status.asFinalized.toHex());
          res(txHash.toHex());
        } else if (status.isInvalid || status.isDropped) {
          rej();
        }
      });
  })
}
