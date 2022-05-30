import { Constants } from 'libzkbob-rs-node'

const constants = {
  FALLBACK_RPC_URL_SWITCH_TIMEOUT: 60 * 60 * 1000,
  TX_QUEUE_NAME: 'tx',
  SENT_TX_QUEUE_NAME: 'sent',
  MAX_SENT_LIMIT: 10,
  TX_CHECK_DELAY: 30000,
  OUTPLUSONE: Constants.OUT + 1,
  TRANSFER_INDEX_SIZE: 12,
  ENERGY_SIZE: 28,
  TOKEN_SIZE: 16,
  POOL_ID_SIZE: 6,
}

export = constants
