import { Params, Proof } from 'libzkbob-rs-node'

const txParams = Params.fromFile('./params/transfer_params.bin')

process.on('message', ({ pub, sec }) => {
  const proof = Proof.tx(txParams, pub, sec)

  if (process.send) process.send(proof)
  process.exit()
})
