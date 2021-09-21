import express from 'express'
import cors from 'cors'
import { Pool } from './pool'

const PORT = 8000
const app = express()

const pool = new Pool()

app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.text())

// Used only for testing as proving on client is now slow
app.post('/proof_tx', (req, res) => {
  const {pub, sec} = JSON.parse(req.body)
  const proof = pool.getTxProof(pub, sec)
  res.json(proof)
})

app.get('/transactions/:limit(\d+)/:offset(\d+)', (req, res) => {
  const limit = parseInt(req.params.limit)
  const offset = parseInt(req.params.offset)
  const txs = pool.getTransactions(limit, offset)
  res.json(txs)
})

app.get('/merkle/proof/:index(\d+)', (req, res) => {
  const noteIndex = parseInt(req.params.index)
  const proof = pool.getMerkleProof(noteIndex)
  res.json(proof)
})


app.post('/transaction', (req, res) => {
  const { proof, memo, txType } = JSON.parse(req.body)
  const buf = Buffer.from(memo, 'base64')
  const treeProof = pool.processMemo(buf, txType)
  pool.transact(proof, treeProof, buf, txType)
  res.sendStatus(204)
})

app.listen(PORT, () => console.log(`Started relayer on port ${PORT}`))
