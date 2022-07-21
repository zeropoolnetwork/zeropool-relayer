import type Web3 from 'web3'
import { toBN, toWei } from 'web3-utils'
import config from '../config'
import { setIntervalAndRun } from '../utils/helpers'
import { estimateFees } from '@mycrypto/gas-estimation'
import { GasPriceOracle } from 'gas-price-oracle'
import type { GasPriceKey } from 'gas-price-oracle/lib/types'
import { logger } from './appLogger'

// GasPrice fields
interface LegacyGasPrice {
  gasPrice: string
}
interface EIP1559GasPrice {
  maxFeePerGas: string
  maxPriorityFeePerGas: string
}
export type GasPriceValue = LegacyGasPrice | EIP1559GasPrice

type EstimationEIP1559 = 'eip1559-gas-estimation'
type EstimationOracle = 'gas-price-oracle'
type EstimationWeb3 = 'web3'
export type EstimationType = EstimationEIP1559 | EstimationOracle | EstimationWeb3

type EstimationOracleOptions = { speedType: GasPriceKey; factor: number }
type EstimationOptions<ET extends EstimationType> = ET extends EstimationOracle ? EstimationOracleOptions : {}

type FetchFunc<ET extends EstimationType> = (_: EstimationOptions<ET>) => Promise<GasPriceValue>

export class GasPrice<ET extends EstimationType> {
  private fetchGasPriceInterval: NodeJS.Timeout | null = null
  private cachedGasPrice: GasPriceValue
  private updateInterval: number
  private fetchGasPrice: FetchFunc<ET>
  private options: EstimationOptions<ET>
  private web3: Web3

  static defaultGasPrice = { gasPrice: config.gasPriceFallback }

  constructor(web3: Web3, updateInterval: number, estimationType: ET, options: EstimationOptions<ET>) {
    this.cachedGasPrice = GasPrice.defaultGasPrice
    this.updateInterval = updateInterval
    this.web3 = web3
    this.fetchGasPrice = this.getFetchFunc(estimationType)
    this.options = options
  }

  async start() {
    if (this.fetchGasPriceInterval) clearInterval(this.fetchGasPriceInterval)

    this.fetchGasPriceInterval = await setIntervalAndRun(async () => {
      try {
        this.cachedGasPrice = await this.fetchGasPrice(this.options)
        logger.info('Updated gasPrice: %o', this.cachedGasPrice)
      } catch (e) {
        logger.warn('Failed to fetch gasPrice %o; using default value', e)
        this.cachedGasPrice = GasPrice.defaultGasPrice
      }
    }, this.updateInterval)
  }

  getPrice() {
    return this.cachedGasPrice
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
    // @ts-ignore
    const options = await estimateFees(this.web3)
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
