import '../env'
import { keypair } from '../services/polkadot'
import { toBN } from 'web3-utils'

const {
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
  RELAYER_FEE,
  RELAYER_GAS_LIMIT,
  MAX_NATIVE_AMOUNT_FAUCET,
  PORT,
} = process.env as Record<PropertyKey, string>

export const config = {
  port: parseInt(PORT),
  poolAddress: POOL_ADDRESS,
  relayerFee: toBN(RELAYER_FEE),
  maxFaucet: toBN(MAX_NATIVE_AMOUNT_FAUCET),
}