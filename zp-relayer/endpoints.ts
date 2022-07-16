import fs from 'fs'
import childProcess from 'child_process'
import { Request, Response, NextFunction } from 'express'
import { pool } from './pool'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'

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

async function sendTransactions(req: Request, res: Response, next: NextFunction) {
  console.log(req.body)
  const rawTxs = typeof (req.body) == "object" ? req.body : JSON.parse(req.body)
  try {
    const txs = rawTxs.map((tx: any) => {
      const {proof, memo, txType, depositSignature} = tx
      return {
        txProof: proof,
        rawMemo: memo,
        txType,
        depositSignature
      }
    })
    const jobId = await pool.transact(txs)
    res.json({ jobId })
  } catch (err) {
    next(err)
  }
}

async function sendTransaction(req: Request, res: Response, next: NextFunction) {
  const { proof, memo, txType, depositSignature } = typeof (req.body) == "object" ? req.body : JSON.parse(req.body)
  try {
    const tx = [{ txProof: proof, rawMemo: memo, txType, depositSignature }]
    const jobId = await pool.transact(tx)
    res.json({ jobId })
  } catch (err) {
    next(err)
  }
}

async function merkleRoot(req: Request, res: Response, next: NextFunction) {
  const index = req.params.index
  try {
    const root = await pool.getContractMerkleRoot(index)
    res.json(root)
  } catch (err) {
    next(err)
  }
}

async function getTransactions(req: Request, res: Response, next: NextFunction) {
  const limit = Number(req.query.limit as string || '100')
  const isOptimistic = req.query.optimistic === 'true'
  if (isNaN(limit) || limit <= 0) {
    next(new Error("limit must be a positive number"))
    return
  }

  const offset = Number(req.query.offset as string || '0')
  if (isNaN(offset) || offset < 0) {
    next(new Error("offset must be a positive number or zero"))
    return
  }

  const state = isOptimistic ? pool.optimisticState : pool.state
  const { txs } = await state.getTransactions(limit, offset)
  res.json(txs)
}

async function getTransactionsV2(req: Request, res: Response, next: NextFunction) {
  const limit = Number(req.query.limit as string || '100')
  if (isNaN(limit) || limit <= 0) {
    next(new Error("limit must be a positive number"))
    return
  }

  const offset = Number(req.query.offset as string || '0')
  if (isNaN(offset) || offset < 0) {
    next(new Error("offset must be a positive number or zero"))
    return
  }

  const toV2Format = (prefix: string) => (tx: string) => {
    const outCommit = tx.slice(0, 64)
    const txHash = tx.slice(64, 128)
    const memo = tx.slice(128)
    return prefix + txHash + outCommit + memo
  }

  const txs: string[] = []
  const { txs: poolTxs, nextOffset } = await pool.state.getTransactions(limit, offset)
  txs.push(...poolTxs.map(toV2Format('1')))

  if (txs.length < limit) {
    const { txs: optimisticTxs } = await pool.optimisticState.getTransactions(limit - txs.length, nextOffset)
    txs.push(...optimisticTxs.map(toV2Format('0')))
  }

  res.json(txs)
}

async function getJob(req: Request, res: Response) {
  const jobId = req.params.id
  const job = await poolTxQueue.getJob(jobId)
  if (job) {
    const state = await job.getState()
    const txHash = job.returnvalue
    const createdOn = job.timestamp
    const finishedOn = job.finishedOn

    res.json({
      state,
      txHash,
      createdOn,
      finishedOn,
    })
  } else {
    res.json(`Job ${jobId} not found`)
  }
}

function relayerInfo(req: Request, res: Response) {
  const deltaIndex = pool.state.getNextIndex()
  const root = pool.state.getMerkleRoot()

  res.json({
    root,
    deltaIndex,
  })
}

export default {
  txProof,
  sendTransaction,
  sendTransactions,
  merkleRoot,
  getTransactions,
  getTransactionsV2,
  getJob,
  relayerInfo,
}
