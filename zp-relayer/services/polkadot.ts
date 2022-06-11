import '@polkadot/api-augment/substrate';

import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady } from '@polkadot/util-crypto'
const {
  RPC_URL,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as { [key: PropertyKey]: string }

// TODO: Remove globals
// Construct
const wsProvider = new WsProvider(RPC_URL)
export let api = new ApiPromise({
  provider: wsProvider,
})
// FIXME: Find a better way to initialize the library
export let keyring: Keyring
export let keypair: KeyringPair

export async function initPolkadot() {
  await cryptoWaitReady()
  await api.isReadyOrError
  keyring = new Keyring({ type: 'sr25519' })
  keypair = keyring.addFromUri(RELAYER_ADDRESS_PRIVATE_KEY)
}
