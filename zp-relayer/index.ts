import './env'
import fs from 'fs'
import cors from 'cors'
import express from 'express'
import router from './router'
import { logger } from './services/appLogger'
import { createLoggerMiddleware } from './services/loggerMiddleware'
import { createPoolTxWorker } from './poolTxWorker'
import { createSentTxWorker } from './sentTxWorker'
import { config } from './config/config'
import { pool } from './pool'

pool.init().then(async () => {
  (await createPoolTxWorker()).run();
  (await createSentTxWorker()).run();
})

const {
  TX_PROOFS_DIR,
} = process.env as Record<PropertyKey, string>

fs.mkdirSync(TX_PROOFS_DIR, { recursive: true })

const app = express()

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.text())

app.use(createLoggerMiddleware('zp.log'))

app.use(router)

app.listen(config.port, () => logger.info(`Started relayer on port ${config.port}`))
