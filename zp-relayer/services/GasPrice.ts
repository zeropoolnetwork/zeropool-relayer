import type Web3 from 'web3'
import type { ProviderLike } from '@mycrypto/eth-scan'
import { toBN, toWei } from 'web3-utils'
import { config } from '../config/config'
import { setIntervalAndRun } from '../utils/helpers'
import { estimateFees } from '@mycrypto/gas-estimation'
import { GasPriceOracle } from 'gas-price-oracle'
import type { GasPriceKey } from 'gas-price-oracle/lib/types'

// GasPrice fields
interface LegacyGasOptions {
  gasPrice: string
}
interface EIP1559GasOptions {
  maxFeePerGas: string
  maxPriorityFeePerGas: string
}
type GasPriceOptions = LegacyGasOptions | EIP1559GasOptions

// Estimation types
type EstimationEIP1559 = 'eip1559-gas-estimation'
type EstimationOracle = 'gas-price-oracle'
type EstimationWeb3 = 'web3'
type EstimationType = EstimationEIP1559 | EstimationOracle | EstimationWeb3

type EstimationOracleOptions = { speedType: GasPriceKey; factor: number }
type EstimationOptions<ET extends EstimationType> = ET extends EstimationOracle ? EstimationOracleOptions : {}

type FetchFunc<ET extends EstimationType> = (_: EstimationOptions<ET>) => Promise<GasPriceOptions>

class GasPrice<ET extends EstimationType> {
  fetchGasPriceInterval: NodeJS.Timeout | null = null
  cachedGasPriceOptions: GasPriceOptions
  updateInterval: number
  fetchGasPrice: FetchFunc<ET>
  options: EstimationOptions<ET>
  web3: Web3

  constructor(web3: Web3, estimationType: ET, options: EstimationOptions<ET>, updateInterval: number) {
    this.cachedGasPriceOptions = { gasPrice: config.gasPrice }
    this.updateInterval = updateInterval
    this.web3 = web3
    this.fetchGasPrice = this.getFetchFunc(estimationType)
    this.options = options
  }

  async start() {
    if (this.fetchGasPriceInterval) clearInterval(this.fetchGasPriceInterval)

    this.cachedGasPriceOptions = { gasPrice: config.gasPrice }

    this.fetchGasPriceInterval = await setIntervalAndRun(async () => {
      this.cachedGasPriceOptions = await this.fetchGasPrice(this.options)
    }, this.updateInterval)
  }

  private getFetchFunc(estimationType: ET): FetchFunc<ET> {
    const funcs: Record<EstimationType, FetchFunc<EstimationType>> = {
      'web3': this.fetchGasPriceWeb3,
      'eip1559-gas-estimation': this.fetchGasPriceEIP1559,
      'gas-price-oracle': this.fetchGasPriceOracle,
    }
    return funcs[estimationType]
  }

  private fetchGasPriceEIP1559: FetchFunc<EstimationEIP1559> = async () => {
    const options = await estimateFees(this.web3 as ProviderLike)
    const res = {
      maxFeePerGas: options.maxFeePerGas.toString(10),
      maxPriorityFeePerGas: options.maxPriorityFeePerGas.toString(10),
    }
    return res
  }

  private fetchGasPriceWeb3: FetchFunc<EstimationWeb3> = async () => {
    const gasPrice = await this.web3.eth.getGasPrice()
    return { gasPrice }
  }

  // TODO: defaults to Mainnet; provide options for other supported oracles
  private fetchGasPriceOracle: FetchFunc<EstimationOracle> = async options => {
    const gasPriceOracle = new GasPriceOracle()
    const json = await gasPriceOracle.fetchGasPricesOffChain()
    const gasPrice = GasPrice.normalizeGasPrice(json[options.speedType], options.factor).toString(10)
    return { gasPrice }
  }

  static normalizeGasPrice(oracleGasPrice: number, factor: number, limits = null) {
    const gasPrice = oracleGasPrice * factor
    return toBN(toWei(gasPrice.toFixed(2).toString(), 'gwei'))
  }
}
