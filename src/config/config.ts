import '../env'
import Web3 from 'web3'

const {
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as Record<PropertyKey, string>

const relayerAddress = new Web3().eth.accounts.privateKeyToAccount(RELAYER_ADDRESS_PRIVATE_KEY).address
export const config = {
  relayerAddress,
  relayerPrivateKey: RELAYER_ADDRESS_PRIVATE_KEY,
  poolAddress: POOL_ADDRESS
}