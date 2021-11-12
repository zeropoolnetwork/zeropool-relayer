import { Constants } from 'libzeropool-rs-node'

const constants = {
  FALLBACK_RPC_URL_SWITCH_TIMEOUT: 60 * 60 * 1000,
  TX_QUEUE_NAME: 'tx',
  OUTPLUSONE: Constants.OUT + 1,
}

export = constants
