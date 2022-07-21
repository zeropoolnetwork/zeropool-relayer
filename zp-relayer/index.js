const { Job, Worker, Queue } = require('bullmq')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function processTx(b) {
  console.log('processing', b)
  for (const j of b) {
    await sleep(1000)
    console.log(j)
  }
}

async function collectBatch(worker, s) {
  const token = 'relayer'

  const jobs = []
  for (let i = 0; i < s; i++) {
    const job = await worker.getNextJob(token)
    if (job) {
      jobs.push(job.data)
    } else return jobs
  }
  return jobs
}

async function createTxWorker() {
  const myQueue = new Queue('foo')

  for (let i = 0; i < 8; i++) {
    await myQueue.add('myJobName', i)
  }

  const worker = new Worker('foo')

  while (true) {
    const b = await collectBatch(worker, 3)
    await processTx(b)
  }
}

createTxWorker()
