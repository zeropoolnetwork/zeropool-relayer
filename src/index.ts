import express from 'express'
import cors from 'cors'
import { Pool } from './pool'

const PORT = 8000
const app = express()

const pool = new Pool()

app.use(cors())
app.use(express.urlencoded({extended: true}))
app.use(express.json())
app.use(express.text())

// TODO add handler
app.get('/transactions/:limit/:offset', (req, res) => {
    res.sendStatus(204)
})

app.post('/transaction', (req, res) => {
    const { proof, memo } = JSON.parse(req.body)
    const treeProof = pool.processMemo(memo)
    pool.transact(proof, treeProof)
    res.sendStatus(204)
})

app.listen(PORT, () => console.log(`Started relayer on port ${PORT}`))
