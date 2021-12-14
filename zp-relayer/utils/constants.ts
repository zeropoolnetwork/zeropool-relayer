import { Constants } from 'libzeropool-rs-node'

const constants = {
  FALLBACK_RPC_URL_SWITCH_TIMEOUT: 60 * 60 * 1000,
  TX_QUEUE_NAME: 'tx',
  OUTPLUSONE: Constants.OUT + 1,
  TRANSFER_INDEX_SIZE: 12,
  ENERGY_SIZE: 28,
  TOKEN_SIZE: 16,
  POOL_ID_SIZE: 6,
}

export = constants
