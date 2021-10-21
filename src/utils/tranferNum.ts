import { logger } from '../services/appLogger'
import { redis } from '../services/redisClient'
import { pool } from '../pool'

const transferNumKey = `relayer:transferNum`

export async function readTransferNum(forceUpdate?: boolean) {
  logger.debug('Reading transferNum')
  if (forceUpdate) {
    logger.debug('Forcing update of transferNum')
    return pool.getContractTransferNum()
  }

  const num = await redis.get(transferNumKey)
  if (num) {
    logger.debug(`TransferNum found in the DB ${num}`)
    return Number(num)
  } else {
    logger.warn(`Nonce wasn't found in the DB`)
    return pool.getContractTransferNum()
  }
}

export function updateTransferNum(num: number) {
  return redis.set(transferNumKey, num)
}
