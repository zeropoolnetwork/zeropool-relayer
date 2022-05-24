import { Job, Worker } from 'bullmq'
import { logger } from './services/appLogger'

export abstract class RelayerWorker<T> {
  name: string
  interval: number
  internalWorker: Worker<T>
  token: string

  constructor(name: string, interval: number, worker: Worker<T>, token: string = 'RELAYER') {
    this.name = name
    this.interval = interval
    this.internalWorker = worker
    this.token = token
  }

  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  abstract init(): Promise<void>
  abstract checkPreconditions(): Promise<boolean>
  abstract run(job: Job<T>): Promise<any>

  async start() {
    await this.init()

    logger.info(`Started ${this.name} worker`)
    while (true) {
      await this.sleep(this.interval)

      const canRun = await this.checkPreconditions()
      if (!canRun) continue

      const job: Job<T> | undefined = await this.internalWorker.getNextJob(this.token)
      if (!job) continue
      try {
        const result = await this.run(job)
        await job.moveToCompleted(result, this.token)
      } catch (e) {
        await job.moveToFailed(e as Error, this.token)
      }
    }
  }
}