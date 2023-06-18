import fs from 'fs'

import { logger } from './services/appLogger'

// FIXME: Replace this rudimentary implementation with a proper transaction storage.
export class TxCache {
    constructor(public path: string) { }

    add(tx: any) {
        const txs = this.load()

        if (!txs.find((t: any) => t.hash === tx.hash)) {
            logger.info('Saving transaction to cache...')
            txs.push(tx)
            fs.writeFileSync(this.path, JSON.stringify(txs))
            logger.info('Total transactions in cache: ' + txs.length)
        } else {
            logger.info('Transaction already in cache')
        }
    }

    load(): any[] {
        return JSON.parse(fs.readFileSync(this.path, 'utf8'))
    }
}