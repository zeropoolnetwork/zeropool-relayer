import Web3 from 'web3'
import type { TransactionConfig } from 'web3-core'

export async function signAndSend(txConfig: TransactionConfig, privateKey: string, web3: Web3): Promise<string> {
  const serializedTx = await web3.eth.accounts.signTransaction(txConfig, privateKey)

  return new Promise((res, rej) =>
    web3.eth
      .sendSignedTransaction(serializedTx.rawTransaction as string)
      .once('transactionHash', res)
      .once('error', rej)
  )
}
