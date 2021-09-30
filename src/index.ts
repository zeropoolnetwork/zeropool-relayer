import fs from 'fs'
import cors from 'cors'
import express from 'express'
import winston from 'winston'
import expressWinston from 'express-winston'
import { Pool } from './pool'
import { assert } from 'console'

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
  console.log('Proving tx...')
  const { pub, sec } = JSON.parse(req.body)
  const curIndex = pool.tree.getNextIndex()
  fs.writeFileSync(`object${curIndex}.json`, JSON.stringify([pub, sec], null, 2))
  const proof = pool.getTxProof(pub, sec)
  console.log('proved')
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

router.get('/merkle/proof/:index(\\d+)', (req, res) => {
  const noteIndex = parseInt(req.params.index)
  console.log('MERKLE PROOF INDEX', noteIndex)
  const proof = pool.getMerkleProof(noteIndex)
  const root = pool.getLocalMerkleRoot()
  console.log('ROOT', root)
  res.json(proof)
})


router.post('/transaction', async (req, res) => {
  const { proof, memo, txType, depositSignature } = JSON.parse(req.body)
  const buf = Buffer.from(memo, 'hex')
  const treeProof = pool.processMemo(buf, txType)
  await pool.transact(proof, treeProof, buf, txType, depositSignature)
  res.json('OK')
})

app.use(expressWinston.logger({
  transports: [
    new winston.transports.File({ filename: 'zp.log' })
  ],
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.json()
  )
}))

app.use(router)

app.listen(PORT, () => console.log(`Started relayer on port ${PORT}`))
