import '../env'
import Web3 from 'web3'
import { toBN } from 'web3-utils'

const {
  POOL_ADDRESS,
  RELAYER_ADDRESS_PRIVATE_KEY,
  RELAYER_FEE,
  RELAYER_GAS_LIMIT,
  MAX_NATIVE_AMOUNT_FAUCET,
  PORT,
  TREE_UPDATE_PARAMS_PATH,
  TX_VK_PATH,
  GAS_PRICE,
} = process.env as Record<PropertyKey, string>

const relayerAddress = new Web3().eth.accounts.privateKeyToAccount(RELAYER_ADDRESS_PRIVATE_KEY).address
export const config = {
  port: PORT ? parseInt(PORT) : 8000,
  relayerAddress,
  relayerPrivateKey: RELAYER_ADDRESS_PRIVATE_KEY,
  relayerGasLimit: toBN(RELAYER_GAS_LIMIT),
  poolAddress: POOL_ADDRESS,
  relayerFee: toBN(RELAYER_FEE),
  maxFaucet: toBN(MAX_NATIVE_AMOUNT_FAUCET),
  treeUpdateParamsPath: TREE_UPDATE_PARAMS_PATH || './params/tree_params.bin',
  txVKPath: TX_VK_PATH || './params/transfer_verification_key.json',
  gasPrice: GAS_PRICE,
}
