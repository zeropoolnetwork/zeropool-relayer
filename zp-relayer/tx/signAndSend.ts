import BN from 'bn.js'
import Web3 from 'web3'
import type { TransactionConfig} from 'web3-core'

export async function signAndSend(
  {
    data,
    nonce,
    gasPrice,
    value,
    gas,
    to,
    chainId,
  }: TransactionConfig,
  privateKey: string,
  web3: Web3
): Promise<string> {
  const serializedTx = await web3.eth.accounts.signTransaction(
    {
      nonce,
      chainId,
      to,
      data,
      value,
      gasPrice,
      gas
    },
    privateKey
  )

  return new Promise((res, rej) =>
    web3.eth
      .sendSignedTransaction(serializedTx.rawTransaction as string)
      .once('transactionHash', res)
      .once('error', rej)
  )
}
