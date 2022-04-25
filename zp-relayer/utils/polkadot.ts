

import { logger } from '../services/appLogger'
import { api } from '../services/polkadot'
// import { blake2AsHex } from '@polkadot/util-crypto'
import { readLatestCheckedBlock, RelayerKeys, updateField } from './redisFields'

// const topic = blake2AsHex('ZeropoolMessage')

export type MessageEvent = { poolIndex: string, allMessagesHash: string, outCommit: string, data: string }

function transformEvent(ev: any): MessageEvent {
  let [poolIndex, allMessagesHash, outCommit, data] = ev.data.toJSON() as any
  return { poolIndex, allMessagesHash, outCommit, data }
}

// TODO: Subscribe to event and update state in background?
// FIXME: Find a way to get only events that are actually needed respecting topics and fromBlock (or an alternative).
export async function getEvents(): Promise<MessageEvent[]> {
  try {
    const pastEvents: MessageEvent[] = []
    const fromBlock = Number(await readLatestCheckedBlock())
    // TODO: Use indexed events
    // const eventIndices = await api.query.system.eventTopics(topic)

    const { number } = await api.rpc.chain.getHeader()
    const lastBlock = number.toNumber()

    logger.info(`Scanning blocks from ${fromBlock} to ${lastBlock}`)

    for (let i = fromBlock + 1; i <= lastBlock; ++i) {
      let hash = await api.rpc.chain.getBlockHash(i)
      let events = await api.query.system.events.at(hash)

      events.forEach((record) => {
        const ev = record.event
        if (ev.section == 'zeropool' && ev.method == 'Message') {
          const event = transformEvent(ev)
          logger.debug('Found zeropool Message event (index %o)', event.poolIndex)
          pastEvents.push(event)
        }
      });
    }

    logger.debug(`${pastEvents.length} Past events obtained`)
    await updateField(RelayerKeys.LATEST_CHECKED_BLOCK, lastBlock)

    return pastEvents
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error(`Events could not be obtained`)
  }
}

export async function subscibeToEvents(handler: (event: MessageEvent) => Promise<void>) {
  api.query.system.events((events) => {
    logger.debug(`Received ${events.length} events:`);

    events.forEach((record) => {
      const { event: ev } = record;
      if (ev.section == 'zeropool' && ev.method == 'Message') {
        const event = transformEvent(ev)
        logger.info(`New Message event at ${event.poolIndex}`);
        handler(event)
      }
    });
  });
}
