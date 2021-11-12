import BN from 'bn.js'
import Web3 from 'web3'
import { toWei } from 'web3-utils'

export async function signAndSend(
  privateKey: string,
  data: string,
  nonce: number,
  gasPrice: string,
  amount: BN,
  gasLimit: string | number,
  to: string,
  chainId: number,
  web3: Web3
): Promise<string> {
  const serializedTx = await web3.eth.accounts.signTransaction(
    {
      nonce,
      chainId,
      to,
      data,
      value: toWei(amount),
      gasPrice,
      gas: gasLimit
    },
    privateKey
  )

  return new Promise((res, rej) =>
    web3.eth
      .sendSignedTransaction(serializedTx.rawTransaction as string)
      .on('transactionHash', res)
      .once('error', rej)
  )
}
