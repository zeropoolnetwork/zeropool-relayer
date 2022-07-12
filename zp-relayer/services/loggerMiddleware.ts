import winston from 'winston'
import expressWinston from 'express-winston'

export function createLoggerMiddleware(filename: string = 'zp.log') {
  return expressWinston.logger({
    transports: [new winston.transports.File({ filename })],
    format: winston.format.combine(winston.format.json()),
  })
}
