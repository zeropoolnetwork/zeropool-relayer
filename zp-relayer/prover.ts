import { Params, Proof } from 'libzeropool-rs-node'

export const txParams = Params.fromFile('./params/transfer_params.bin')
export const ddParams = Params.fromFile('./params/delegated_deposit_params.bin')

export async function proveTx(pub: any, sec: any) {
  const proof = await Proof.txAsync(txParams, pub, sec)
  return proof
}
