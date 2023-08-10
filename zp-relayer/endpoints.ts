import fs from 'fs'
import childProcess from 'child_process'
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

    const child = childProcess.fork('./prover.js')
    child.send({ pub, sec })
    child.on('message', p => {
      logger.debug('Tx proved')
      res.json(p)
    })
  }
})()

async function transaction(req: Request, res: Response) {
  const body = JSON.parse(req.body)
  const { proof, memo, txType } = body

  const extraData = body.extraData || body.depositSignature

  console.info(body)

  const jobId = await pool.transact(proof, memo, txType, extraData)
  res.json({ jobId })
}

async function sendTransactions(req: Request, res: Response) {
  const rawTxs = req.body

  if (rawTxs.length > 1) {
    throw new Error('Batch transactions not supported')
  }

  const { proof, memo, txType } = rawTxs[0]

  const extraData = rawTxs[0].extraData || rawTxs[0].depositSignature

  const jobId = await pool.transact(proof, memo, txType, extraData)
  res.json({ jobId })
}


async function merkleRoot(req: Request, res: Response) {
  const index = req.params.index
  const root = await pool.getContractMerkleRoot(index)
  res.json(root)
}

async function getTransactions(req: Request, res: Response) {
  const limit = parseInt(req.query.limit as string || '100')
  const offset = parseInt(req.query.offset as string || '0')
  const txs = await pool.getTransactions(limit, offset)
  res.json(txs)
}

async function getTransactionsV2(req: Request, res: Response) {
  // const errors = checkGetTransactionsV2(req.query)
  // if (errors) {
  //   logger.info('Request errors: %o', errors)
  //   res.status(400).json({ errors })
  //   return
  // }

  const toV2Format = (prefix: string) => (tx: string) => {
    const outCommit = tx.slice(0, 64)
    const txHash = tx.slice(64, 128)
    const memo = tx.slice(128)
    return prefix + txHash + outCommit + memo
  }

  // Types checked in validation stage
  const limit = parseInt(req.query.limit as string || '100')
  const offset = parseInt(req.query.offset as string || '0')

  const txs = (await pool.getTransactions(limit, offset)).map(toV2Format('1'))

  // if (txs.length < limit) {
  //   const { txs: optimisticTxs } = await pool.optimisticState.getTransactions(limit - txs.length, nextOffset)
  //   txs.push(...optimisticTxs.map(toV2Format('0')))
  // }

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

async function relayerInfo(req: Request, res: Response) {
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
  sendTransactions,
  merkleRoot,
  getTransactions,
  getTransactionsV2,
  getJob,
  relayerInfo,
}
