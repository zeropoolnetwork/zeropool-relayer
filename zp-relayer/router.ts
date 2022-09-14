import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import endpoints from './endpoints'

function wrapErr(f: (_req: Request, _res: Response, _next: NextFunction) => Promise<void> | void) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await f(req, res, next)
    } catch (e) {
      next(e)
    }
  }
}

const router = express.Router()

router.use(cors())
router.use(express.urlencoded({ extended: true }))
router.use(express.json())
router.use(express.text())

router.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err) {
    console.error('Request error:', err)
    return res.sendStatus(500)
  }
  next()
})

// Used only for testing as proving on client is now slow
router.post('/proof_tx', endpoints.txProof)

router.get('/', endpoints.root)
router.post('/sendTransaction', wrapErr(endpoints.sendTransaction))
router.post('/sendTransactions', wrapErr(endpoints.sendTransactions))
router.get('/transactions', wrapErr(endpoints.getTransactions))
router.get('/transactions/v2', wrapErr(endpoints.getTransactionsV2))
router.get('/merkle/root/:index?', wrapErr(endpoints.merkleRoot))
router.get('/job/:id', wrapErr(endpoints.getJob))
router.get('/info', wrapErr(endpoints.relayerInfo))
router.get('/fee', wrapErr(endpoints.getFee))
router.get('/limits', wrapErr(endpoints.getLimits))
router.get('/blockchain/tx/:hash', wrapErr(endpoints.getBlockchainTransaction))

export default router
