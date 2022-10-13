import Web3 from 'web3'
import config from '../config'

export let web3: Web3

export function initWeb3() {
  web3 = new Web3(config.rpcUrl)
}