import Web3 from 'web3'
const { RPC_URL } = process.env as Record<PropertyKey, string>

export const web3 = new Web3(RPC_URL)
