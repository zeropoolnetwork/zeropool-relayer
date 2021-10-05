import Redis from 'ioredis'
import { logger } from './appLogger'

export const redis = new Redis(process.env.RELAYER_REDIS_URL)

redis.on('connect', () => {
  logger.info('Connected to redis')
})

redis.on('error', () => {
  logger.error('Disconnected from redis')
})
