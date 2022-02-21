import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
const {
  RPC_URL,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>

// Construct
const wsProvider = new WsProvider(RPC_URL)
export const api = new ApiPromise({ provider: wsProvider })
export const keyring = new Keyring({ type: 'sr25519' })
export const keypair = keyring.addFromUri(RELAYER_ADDRESS_PRIVATE_KEY)