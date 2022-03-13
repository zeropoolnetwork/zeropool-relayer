import { logger } from '../services/appLogger'
import { redis } from '../services/redisClient'
import { pool } from '../pool'

export enum RelayerKeys {
  TRANSFER_NUM = 'relayer:transferNum',
  NONCE = `relayer:nonce`,
  LATEST_CHECKED_BLOCK = `relayer:latestCheckedBlock`,
}

export const readTransferNum = readFieldBuilder(RelayerKeys.TRANSFER_NUM, () => pool.getContractTransferNum())
export const readLatestCheckedBlock = readFieldBuilder(RelayerKeys.LATEST_CHECKED_BLOCK, () => 0)

function readFieldBuilder(
  key: RelayerKeys,
  forceUpdateFunc?: Function,
) {
  return async (forceUpdate?: boolean) => {
    const update = () => {
      if (!forceUpdateFunc) throw new Error('Force update function not provided')
      return forceUpdateFunc()
    }

    logger.debug(`Reading ${key}`)
    if (forceUpdate) {
      logger.debug(`Forcing update of ${key}`)
      return update()
    }

    const val = await redis.get(key)
    if (val) {
      logger.debug(`${key} found in the DB: ${val}`)
      return val
    } else {
      logger.warn(`${key} wasn't found in the DB`)
      return update()
    }
  }
}

export function updateField(key: RelayerKeys, val: any) {
  return redis.set(key, val)
}
