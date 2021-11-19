import {
  Params,
  Proof,
} from 'libzeropool-rs-node'

const txParams = Params.fromFile('./transfer_params.bin')

process.on('message', ({ pub, sec }) => {
  const proof = Proof.tx(txParams, pub, sec)

  if (process.send) process.send(proof)
  process.exit()
})
