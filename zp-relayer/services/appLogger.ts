import { createLogger, format, transports } from 'winston'

export const logger = createLogger({
  level: process.env.RELAYER_LOG_LEVEL || 'debug',
  format: format.combine(
    format.colorize(),
    format.timestamp(),
    format.splat(),
    format.simple(),
    // format.printf(context => {
    //   if (typeof context.message === 'object') {
    //     context.message = JSON.stringify(context.message, null, 3)
    //   }
    //   return `${context.level}: ${context.message}`
    // })
  ),
  transports: [
    new transports.Console(),
  ]
})