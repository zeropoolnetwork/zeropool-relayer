import fs from 'fs'
import { Request, Response } from 'express'
import { pool } from './pool'
import { logger } from './services/appLogger'
import { txQueue } from './services/jobQueue'

const {
  TX_PROOFS_DIR,
} = process.env as Record<PropertyKey, string>

const txProof = (() => {
  let txProofNum = 0
  return (req: Request, res: Response) => {
    logger.debug('Proving tx...')
    const { pub, sec } = JSON.parse(req.body)
    if (logger.isDebugEnabled()) {
      fs.writeFileSync(`${TX_PROOFS_DIR}/object${txProofNum}.json`, JSON.stringify([pub, sec], null, 2))
      txProofNum += 1
    }
    const proof = pool.getTxProof(pub, sec)
    logger.debug('Tx proved')
    res.json(proof)
  }
})()

async function transaction(req: Request, res: Response) {
  const { proof, memo, txType, depositSignature } = JSON.parse(req.body)
  const jobId = await pool.transact(proof, memo, txType, depositSignature)
  res.json({ jobId })
}

async function merkleRoot(req: Request, res: Response) {
  const index = req.params.index
  const root = await pool.getContractMerkleRoot(index)
  res.json(root)
}

function getTransactions(req: Request, res: Response) {
  const limit = parseInt(req.params.limit)
  const offset = parseInt(req.params.offset)
  const txs = pool.getTransactions(limit, offset)
  res.json(txs)
}

async function getJob(req: Request, res: Response) {
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
}

function relayerInfo(req: Request, res: Response) {
  const deltaIndex = pool.tree.getNextIndex()
  const root = pool.getLocalMerkleRoot()

  res.json({
    root,
    deltaIndex,
  })
}

export default {
  txProof,
  transaction,
  merkleRoot,
  getTransactions,
  getJob,
  relayerInfo,
}
