import { config } from '../../config/config'
import { setIntervalAndRun } from '../../utils/helpers'
import { estimateFees } from '@mycrypto/gas-estimation'

interface LegacyGasOptions {
  gasPrice: string
}

interface EIP1559GasOptions {
  maxFeePerGas: string
  maxPriorityFeePerGas: string
}

type GasPriceOptions = LegacyGasOptions | EIP1559GasOptions

type GasPriceType = 'eip1559-gas-estimation' | 'gas-price-oracle' | 'default'


abstract class GasPrice {
  fetchGasPriceInterval: NodeJS.Timeout | null = null
  cachedGasPriceOptions: GasPriceOptions
  updateInterval: number

  constructor(updateInterval: number) {
    this.cachedGasPriceOptions = { gasPrice: config.gasPrice }
    this.updateInterval = updateInterval
  }

  async start() {
    if (this.fetchGasPriceInterval) clearInterval(this.fetchGasPriceInterval)

    this.cachedGasPriceOptions = { gasPrice: config.gasPrice }

    this.fetchGasPriceInterval = await setIntervalAndRun(
      async () => {
        this.cachedGasPriceOptions = await this.fetchGasPrice()
      },
      this.updateInterval
    )
  }

  abstract fetchGasPrice(): Promise<GasPriceOptions>

  private async fetchGasPriceEIP1559() {
    const options = await estimateFees(web3)
    const res = {
      maxFeePerGas: options.maxFeePerGas.toString(10),
      maxPriorityFeePerGas: options.maxPriorityFeePerGas.toString(10)
    }
    return res
  }
}