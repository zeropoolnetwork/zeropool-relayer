import './env'
import fs from 'fs'
import cors from 'cors'
import express from 'express'
import { logger } from './services/appLogger'
import { createLoggerMiddleware } from './services/loggerMiddleware'
import { pool } from './pool'
import { assert } from 'console'
import { MerkleProof } from 'libzeropool-rs-node'
import { createTxWorker } from './worker'
import { txQueue } from './services/jobQueue'

const {
  TX_PROOFS_DIR,
} = process.env as Record<PropertyKey, string>

fs.mkdirSync(TX_PROOFS_DIR, { recursive: true })

createTxWorker()

const PORT = 8000
const app = express()

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.text())

const router = express.Router()

let txProofNum = 0

// Used only for testing as proving on client is now slow
router.post('/proof_tx', (req, res) => {
  logger.debug('Proving tx...')
  const { pub, sec } = JSON.parse(req.body)
  if (logger.isDebugEnabled()) {
    fs.writeFileSync(`${TX_PROOFS_DIR}/object${txProofNum}.json`, JSON.stringify([pub, sec], null, 2))
    txProofNum += 1
  }
  const proof = pool.getTxProof(pub, sec)
  logger.debug('Tx proved')
  res.json(proof)
})

router.get('/delta_index', (req, res) => {
  const curIndex = pool.tree.getNextIndex()
  assert(curIndex % 128 === 0, 'INCORRECT INDEX')

  res.json(curIndex)
})

router.get('/transactions/:limit(\\d+)/:offset(\\d+)', (req, res) => {
  const limit = parseInt(req.params.limit)
  const offset = parseInt(req.params.offset)
  const txs = pool.getTransactions(limit, offset)
  res.json(txs)
})

router.get('/merkle/root/:index?', async (req, res) => {
  const index = req.params.index
  const root = await pool.getContractMerkleRoot(index)
  res.json(root)
})

router.get('/merkle/proof', (req, res) => {
  const deltaIndex = pool.tree.getNextIndex()
  const root = pool.getLocalMerkleRoot()

  const index = req.query.index
  let proofs: MerkleProof[] = []
  if (typeof index === 'string') {
    proofs = [pool.getMerkleProof(parseInt(index))]
  } else if (Array.isArray(index)) {
    // @ts-ignore
    proofs = index.map(i => pool.getMerkleProof(parseInt(i)))
  }
  res.json({
    root,
    deltaIndex,
    proofs,
  })
})

router.post('/transaction', async (req, res) => {
  const { proof, memo, txType, depositSignature } = JSON.parse(req.body)
  const jobId = await pool.transact(proof, memo, txType, depositSignature)
  res.json({ jobId })
})

router.get('/job/:id', async (req, res) => {
  const jobId = req.params.id
  const job = await txQueue.getJob(jobId)
  if (job) {
    const state = await job.getState()
    const txHash = job.returnvalue
    res.json({
      state,
      txHash,
    })
  } else {
    res.json(`Job ${jobId} not found`)
  }
})

router.get('/info', (req, res) => {
  const deltaIndex = pool.tree.getNextIndex()
  const root = pool.getLocalMerkleRoot()

  res.json({
    root,
    deltaIndex,
  })
})

app.use(createLoggerMiddleware('zp.log'))

app.use(router)

app.listen(PORT, () => logger.info(`Started relayer on port ${PORT}`))
