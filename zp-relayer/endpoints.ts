import fs from 'fs'
import { Request, Response, NextFunction } from 'express'
import { pool } from './pool'
import { logger } from './services/appLogger'
import { poolTxQueue } from './services/poolTxQueue'
import config from './config'
import { proveTx } from './prover'
import { checkSendTransactionErrors, checkSendTransactionsErrors } from './validation/validation'

const txProof = (() => {
  let txProofNum = 0
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.debug('Proving tx...')
      const { pub, sec } = req.body
      if (logger.isDebugEnabled()) {
        const TX_PROOFS_DIR = 'tx_proofs'
        if (!fs.existsSync(TX_PROOFS_DIR)) {
          fs.mkdirSync(TX_PROOFS_DIR, { recursive: true })
        }
        fs.writeFileSync(`${TX_PROOFS_DIR}/object${txProofNum}.json`, JSON.stringify([pub, sec], null, 2))
        txProofNum += 1
      }
      const proof = await proveTx(pub, sec)
      logger.debug('Tx proved')
      res.json(proof)
    } catch (err) {
      next(err)
    }
  }
})()

async function sendTransactions(req: Request, res: Response, next: NextFunction) {
  const rawTxs = typeof req.body == 'object' ? req.body : JSON.parse(req.body)

  const errors = checkSendTransactionsErrors(rawTxs)
  if (errors) {
    console.log('Request errors:', errors)
    return res.status(400).json({ errors })
  }

  try {
    const txs = rawTxs.map((tx: any) => {
      const { proof, memo, txType, depositSignature } = tx
      return {
        txProof: proof,
        rawMemo: memo,
        txType,
        depositSignature,
      }
    })
    const jobId = await pool.transact(txs)
    res.json({ jobId })
  } catch (err) {
    next(err)
  }
}

async function sendTransaction(req: Request, res: Response, next: NextFunction) {
  const rawTx = typeof req.body == 'object' ? req.body : JSON.parse(req.body)

  const errors = checkSendTransactionErrors(rawTx)
  if (errors) {
    console.log('Request errors:', errors)
    return res.status(400).json({ errors })
  }

  const { proof, memo, txType, depositSignature } = rawTx
  try {
    const tx = [{ proof, memo, txType, depositSignature }]
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
  const limit = Number((req.query.limit as string) || '100')
  const isOptimistic = req.query.optimistic === 'true'
  if (isNaN(limit) || limit <= 0) {
    next(new Error('limit must be a positive number'))
    return
  }

  const offset = Number((req.query.offset as string) || '0')
  if (isNaN(offset) || offset < 0) {
    next(new Error('offset must be a positive number or zero'))
    return
  }

  const state = isOptimistic ? pool.optimisticState : pool.state
  const { txs } = await state.getTransactions(limit, offset)
  res.json(txs)
}

async function getTransactionsV2(req: Request, res: Response, next: NextFunction) {
  const limit = Number((req.query.limit as string) || '100')
  if (isNaN(limit) || limit <= 0) {
    next(new Error('limit must be a positive number'))
    return
  }

  const offset = Number((req.query.offset as string) || '0')
  if (isNaN(offset) || offset < 0) {
    next(new Error('offset must be a positive number or zero'))
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
    const failedReason = job.failedReason
    const createdOn = job.timestamp
    const finishedOn = job.finishedOn

    res.json({
      state,
      txHash,
      failedReason,
      createdOn,
      finishedOn,
    })
  } else {
    res.json(`Job ${jobId} not found`)
  }
}

function relayerInfo(req: Request, res: Response) {
  const deltaIndex = pool.state.getNextIndex()
  const optimisticDeltaIndex = pool.optimisticState.getNextIndex()
  const root = pool.state.getMerkleRoot()
  const optimisticRoot = pool.optimisticState.getMerkleRoot()

  res.json({
    root,
    optimisticRoot,
    deltaIndex,
    optimisticDeltaIndex,
  })
}

function getFee(req: Request, res: Response) {
  res.json({
    fee: config.relayerFee,
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
  getFee,
}
