import fs from 'fs'
import cors from 'cors'
import express from 'express'
import { logger } from './services/appLogger'
import { createLoggerMiddleware } from './services/loggerMiddleware'
import { Pool } from './pool'
import { assert } from 'console'
import { MerkleProof } from 'libzeropool-rs-node'

const PORT = 8000
const app = express()

const pool = new Pool()

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.text())

const router = express.Router();

// Used only for testing as proving on client is now slow
router.post('/proof_tx', (req, res) => {
  logger.debug('Proving tx...')
  const { pub, sec } = JSON.parse(req.body)
  const curIndex = pool.tree.getNextIndex()
  fs.writeFileSync(`object${curIndex}.json`, JSON.stringify([pub, sec], null, 2))
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
  const buf = Buffer.from(memo, 'hex')
  const treeProof = pool.processMemo(buf, txType)
  await pool.transact(proof, treeProof, buf, txType, depositSignature)
  res.json('OK')
})

app.use(createLoggerMiddleware('zp.log'))

app.use(router)

app.listen(PORT, () => logger.info(`Started relayer on port ${PORT}`))
