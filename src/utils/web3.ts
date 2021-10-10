import { logger } from '../services/appLogger'
import Web3 from 'web3'

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
