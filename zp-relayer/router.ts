import express, { NextFunction, Request, Response } from 'express'
import endpoints from './endpoints'

const router = express.Router()

router.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err) {
    console.error(err)
    return res.sendStatus(500)
  }
  next()
})

// Used only for testing as proving on client is now slow
router.post('/proof_tx', endpoints.txProof)

router.post('/sendTransaction', endpoints.sendTransaction)
router.post('/sendTransactions', endpoints.sendTransactions)
router.get('/transactions', endpoints.getTransactions)
router.get('/transactions/v2', endpoints.getTransactionsV2)
router.get('/merkle/root/:index?', endpoints.merkleRoot)
router.get('/job/:id', endpoints.getJob)
router.get('/info', endpoints.relayerInfo)
router.get('/fee', endpoints.getFee)

export default router
