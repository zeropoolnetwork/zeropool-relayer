import fs from 'fs'

import { logger } from './services/appLogger'

// FIXME: Replace this rudimentary implementation with a proper one.
export class TxCache {
    constructor(public path: string) { }

    add(tx: any) {
        logger.info('Saving transaction to cache...')
        const txs = this.load()
        txs.push(tx)
        fs.writeFileSync(this.path, JSON.stringify(txs))
        logger.info('Total transactions in cache: ' + txs.length)
    }

    load(): any[] {
        return JSON.parse(fs.readFileSync(this.path, 'utf8'))
    }
}