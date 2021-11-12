import fetch, { RequestInfo } from 'node-fetch'
import promiseRetry from 'promise-retry'
import { FALLBACK_RPC_URL_SWITCH_TIMEOUT } from '../utils/constants'

// From EIP-1474 and Infura documentation
const JSONRPC_ERROR_CODES = [-32603, -32002, -32005]


interface ProviderOptions {
  name: string,
  requestTimeout: number,
  retry: {
    retries: number
  }
}

const defaultOptions: ProviderOptions = {
  name: 'main',
  requestTimeout: 0,
  retry: {
    retries: 0
  }
}

class HttpListProviderError extends Error {
  errors: Error[]
  constructor(message: string, errors: Error[]) {
    super(message)
    this.errors = errors
  }
}

export default class HttpListProvider {
  urls: string[]
  options: ProviderOptions
  currentIndex: number
  lastTimeUsedPrimary: number

  constructor(urls: string[], options = {}) {
    if (!urls || !urls.length) {
      throw new TypeError(`Invalid URLs: '${urls}'`)
    }

    this.urls = urls
    this.options = { ...defaultOptions, ...options }
    this.currentIndex = 0
    this.lastTimeUsedPrimary = 0
  }

  async send(payload: any, callback: any) {
    // if fallback URL is being used for too long, switch back to the primary URL
    if (this.currentIndex > 0 && Date.now() - this.lastTimeUsedPrimary > FALLBACK_RPC_URL_SWITCH_TIMEOUT) {
      console.log(
        { oldURL: this.urls[this.currentIndex], newURL: this.urls[0] },
        'Switching back to the primary JSON-RPC URL'
      )
      this.currentIndex = 0
    }

    // save the currentIndex to avoid race condition
    const { currentIndex } = this

    try {
      const [result, index] = await promiseRetry(
        retry => this.trySend(payload, currentIndex).catch(retry),
        this.options.retry
      )

      // if some of URLs failed to respond, current URL index is updated to the first URL that responded
      if (currentIndex !== index) {
        console.log(
          { index, oldURL: this.urls[currentIndex], newURL: this.urls[index] },
          'Switching to fallback JSON-RPC URL'
        )
        this.currentIndex = index
      }
      callback(null, result)
    } catch (e) {
      callback(e)
    }    
  }

  async trySend(payload: any, initialIndex: number) {
    const errors: any = []
  
    for (let count = 0; count < this.urls.length; count++) {
      const index = (initialIndex + count) % this.urls.length
  
      // when request is being sent to the primary URL, the corresponding time marker is updated
      if (index === 0) {
        this.lastTimeUsedPrimary = Date.now()
      }
  
      const url = this.urls[index]
      try {
        const result = await this._send(url, payload, this.options)
        return [result, index]
      } catch (e) {
        errors.push(e)
      }
    }
  
    throw new HttpListProviderError('Request failed for all urls', errors)
  }

  async _send(url: RequestInfo, payload: any, options: ProviderOptions) {
    const rawResponse = await fetch(url, {
      headers: {
        'Content-type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(payload),
      timeout: options.requestTimeout
    })

    if (!rawResponse.ok) {
      throw new Error(rawResponse.statusText)
    }

    const response = await rawResponse.json()

    if (
      response.error &&
      (JSONRPC_ERROR_CODES.includes(response.error.code) || response.error.message.includes('ancient block'))
    ) {
      throw new Error(response.error.message)
    }
    return response
  }
}
