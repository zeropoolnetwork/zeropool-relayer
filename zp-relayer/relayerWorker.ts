import { Worker } from 'bullmq'
import { logger } from './services/appLogger'

export abstract class RelayerWorker {
  name: string
  interval: number
  internalWorker: Worker

  constructor(name: string, interval: number, worker: Worker) {
    this.name = name
    this.interval = interval
    this.internalWorker = worker
  }

  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  abstract init(): Promise<void>
  abstract run(): Promise<void>

  async start() {
    await this.init()

    logger.info(`Started ${this.name} worker`)
    while (true) {
      await this.sleep(this.interval)
      await this.run()
    }
  }
}