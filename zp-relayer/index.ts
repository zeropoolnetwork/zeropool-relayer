import './env'
import fs from 'fs'
import cors from 'cors'
import express from 'express'
import { logger } from './services/appLogger'
import { createLoggerMiddleware } from './services/loggerMiddleware'
import { createTxWorker } from './worker'
import endpoints from './endpoints'
import { config } from './config/config'

const {
  TX_PROOFS_DIR,
} = process.env as Record<PropertyKey, string>

fs.mkdirSync(TX_PROOFS_DIR, { recursive: true })

createTxWorker()

const app = express()

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.text())

const router = express.Router()

// Used only for testing as proving on client is now slow
router.post('/proof_tx', endpoints.txProof)

router.post('/transaction', endpoints.transaction)
router.post('/sendTransaction', endpoints.transaction)
router.post('/sendTransactions', endpoints.sendTransactions)
router.get('/transactions', endpoints.getTransactions)
router.get('/transactions/v2', endpoints.getTransactionsV2)
router.get('/merkle/root/:index?', endpoints.merkleRoot)
router.get('/job/:id', endpoints.getJob)
router.get('/info', endpoints.relayerInfo)

app.use(createLoggerMiddleware('zp.log'))

app.use(router)

app.listen(config.port, () => logger.info(`Started relayer on port ${config.port}`))
