import { createLogger, format, transports } from 'winston'

export const logger = createLogger({
  level: process.env.RELAYER_LOG_LEVEL || 'debug',
  format: format.combine(
    format.colorize(),
    format.timestamp(),
    format.splat(),
    format.simple(),
  ),
  transports: [
    new transports.Console(),
  ]
})