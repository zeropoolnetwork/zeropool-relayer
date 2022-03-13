

import { logger } from '../services/appLogger'
import { api } from '../services/polkadot'
// import { blake2AsHex } from '@polkadot/util-crypto'
import { readLatestCheckedBlock, RelayerKeys, updateField } from './redisFields'

// const topic = blake2AsHex('ZeropoolMessage')

export type MessageEvent = { poolIndex: string, allMessagesHash: string, outCommit: string, data: string }

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

      events.forEach((ev) => {
        if (ev.event.section == 'zeropool' && ev.event.method == 'Message') {
          let [poolIndex, allMessagesHash, outCommit, data] = ev.event.data.toJSON() as any
          logger.debug('Found zeropool Message event (index %o)', poolIndex)
          pastEvents.push({ poolIndex, allMessagesHash, outCommit, data })
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
