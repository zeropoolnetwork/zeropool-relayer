import { logger } from '../services/appLogger'
import { api } from '../services/polkadot'
import { blake2AsHex } from '@polkadot/util-crypto'

const topic = blake2AsHex('ZeropoolMessage')

export type MessageEvent = { poolIndex: string, allMessagesHash: string, data: string }

// FIXME: Find a way to get only events that are actually needed respecting topics and fromBlock (or an alternative).
export async function getEvents(_fromBlock: number = 0): Promise<MessageEvent[]> {
  try {
    const pastEvents: MessageEvent[] = []
    // TODO: Use indexed events
    // const eventIndices = await api.query.system.eventTopics(topic)

    const events = (await api.query.system.events()).toJSON() as any[]
    logger.info(`Received ${events.length} events:`)

    events.forEach((ev) => {
      if (ev.section.eq('Zeropool') && ev.method.eq('Message')) {
        let [poolIndex, allMessagesHash, data] = ev.event.data.toJSON()
        logger.debug('Found zeropool Message event (index %o)', poolIndex);
        pastEvents.push({ poolIndex, allMessagesHash, data })
      }
    });

    logger.debug('%o, Past events obtained', { count: pastEvents.length })
    return pastEvents
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error(`Events could not be obtained`)
  }
}
