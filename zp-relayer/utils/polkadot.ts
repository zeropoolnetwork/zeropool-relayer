import { logger } from '../services/appLogger'
import { api } from '../services/polkadot'

export type MessageEvent = { poolIndex: string, allMessagesHash: string, data: string }

// FIXME: Don't fetch all of the events.
// FIXME: Find a way to get only events that are actually needed respecting topics and fromBlock (or an alternative).
export async function getEvents(event: string, _fromBlock: number = 0): Promise<MessageEvent[]> {
  try {
    const pastEvents: MessageEvent[] = []
    await api.query.system.events((events: any[]) => {
      logger.info(`Received ${events.length} events:`)

      events.forEach((record) => {
        let [poolIndex, allMessagesHash, data] = record.event.data;
        pastEvents.push({ poolIndex, allMessagesHash, data })
      });
    });

    logger.debug('%o, Past events obtained', { event, count: pastEvents.length })
    return pastEvents
  } catch (e) {
    if (e instanceof Error) logger.error(e.message)
    throw new Error(`${event} events cannot be obtained`)
  }
}
