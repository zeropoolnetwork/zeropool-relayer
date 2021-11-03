import '../env'
import Web3 from 'web3'
import { toBN } from 'web3-utils'

const {
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
  RELAYER_FEE,
  MAX_NATIVE_AMOUNT_FAUCET,
} = process.env as Record<PropertyKey, string>

const relayerAddress = new Web3().eth.accounts.privateKeyToAccount(RELAYER_ADDRESS_PRIVATE_KEY).address
export const config = {
  relayerAddress,
  relayerPrivateKey: RELAYER_ADDRESS_PRIVATE_KEY,
  poolAddress: POOL_ADDRESS,
  relayerFee: toBN(RELAYER_FEE),
  maxFaucet: toBN(MAX_NATIVE_AMOUNT_FAUCET),
}