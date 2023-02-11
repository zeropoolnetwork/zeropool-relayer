import './env'
import Web3 from 'web3'
import { toBN } from 'web3-utils'
import type { EstimationType } from './services/GasPrice'

const relayerAddress = new Web3().eth.accounts.privateKeyToAccount(
  process.env.RELAYER_ADDRESS_PRIVATE_KEY as string
).address

const config = {
  port: parseInt(process.env.PORT || '8000'),
  relayerAddress,
  relayerPrivateKey: process.env.RELAYER_ADDRESS_PRIVATE_KEY as string,
  poolAddress: process.env.POOL_ADDRESS,
  delegatedDepositsAddress: process.env.DELEGATED_DEPOSITS_ADDRESS,
  delegatedDepositsFlushInterval: parseInt(process.env.DELEGATED_DEPOSITS_FLUSH_INTERVAL || '5000'),
  delegatedDepositsCheckInterval: parseInt(process.env.DELEGATED_DEPOSITS_FLUSH_INTERVAL || '2000'),
  delegatedDepositParamsPath: process.env.DELEGATED_DEPOSIT_PARAMS_PATH || './params/delegated_deposit_params.bin',
  tokenAddress: process.env.TOKEN_ADDRESS,
  relayerGasLimit: toBN(process.env.RELAYER_GAS_LIMIT as string),
  relayerFee: toBN(process.env.RELAYER_FEE as string),
  maxFaucet: toBN(process.env.MAX_NATIVE_AMOUNT_FAUCET as string),
  treeUpdateParamsPath: process.env.TREE_UPDATE_PARAMS_PATH || './params/tree_params.bin',
  txVKPath: process.env.TX_VK_PATH || './params/transfer_verification_key.json',
  ddVKPath: process.env.DD_VK_PATH || './params/delegated_deposit_verification_key.json',
  gasPriceFallback: process.env.GAS_PRICE_FALLBACK as string,
  gasPriceEstimationType: (process.env.GAS_PRICE_ESTIMATION_TYPE as EstimationType) || 'web3',
  gasPriceUpdateInterval: parseInt(process.env.GAS_PRICE_UPDATE_INTERVAL || '5000'),
  logLevel: process.env.RELAYER_LOG_LEVEL || 'debug',
  redisUrl: process.env.RELAYER_REDIS_URL,
  rpcUrl: process.env.RPC_URL as string,
  sentTxDelay: parseInt(process.env.SENT_TX_DELAY || '30000'),
}

export default config
