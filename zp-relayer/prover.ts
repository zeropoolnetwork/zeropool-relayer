import { Params, Proof } from 'libzkbob-rs-node'

const txParams = Params.fromFile('./params/transfer_params.bin')

export async function proveTx(pub: any, sec: any) {
  const proof = await Proof.txAsync(txParams, pub, sec)
  return proof
}
