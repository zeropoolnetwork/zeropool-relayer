import '@polkadot/api-augment/substrate';
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady } from '@polkadot/util-crypto'

import { logger } from '../services/appLogger'
// import { blake2AsHex } from '@polkadot/util-crypto'
import { readLatestCheckedBlock, RelayerKeys, updateField } from '../utils/redisFields'
import { MessageEvent, Chain, TxStatus, PoolCalldata } from './chain';
import { Pool } from '../pool';
import { TxPayload } from '../services/poolTxQueue';

// const topic = blake2AsHex('ZeropoolMessage')

const {
  RPC_URL,
  RELAYER_ADDRESS_PRIVATE_KEY,
} = process.env as { [key: PropertyKey]: string }

export class PolkadotChain implements Chain {
  processTx(id: string, tx: TxPayload, pool: Pool): Promise<{ data: string; commitIndex: number; }> {
    throw new Error('Method not implemented.');
  }
  parseCalldata(tx: string): PoolCalldata {
    throw new Error('Method not implemented.');
  }
  init(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getTxStatus(txId: any): Promise<{ status: TxStatus; blockId?: any; }> {
    throw new Error('Method not implemented.');
  }
  signAndSend(txConfig: any): Promise<string> {
    throw new Error('Method not implemented.');
  }
  getDenominator(): Promise<string> {
    throw new Error('Method not implemented.');
  }
  async getNewEvents(): Promise<MessageEvent[]> {
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

        events.forEach((record: any) => {
          const ev = record.event
          if (ev.section == 'zeropool' && ev.method == 'Message') {
            const event = transformEvent(ev)
            // logger.debug('Found zeropool Message event (index %o)', event.poolIndex)
            pastEvents.push(event)
          }
        })
      }

      logger.debug(`${pastEvents.length} Past events obtained`)
      await updateField(RelayerKeys.LATEST_CHECKED_BLOCK, lastBlock)

      return pastEvents
    } catch (e) {
      if (e instanceof Error) logger.error(e.message)
      throw new Error(`Events could not be obtained`)
    }
  }

  async getContractTransferNum(): Promise<string> {
    const transferNum = await api.query.zeropool.poolIndex()
    return transferNum.toString() // FIXME: Is this correct?
  }

  async getContractMerkleRoot(index: string | null | undefined): Promise<string> {
    throw new Error('Method not implemented.');
  }

}

// TODO: Remove globals
// Construct
const wsProvider = new WsProvider(RPC_URL)
export const api = new ApiPromise({
  provider: wsProvider,
  types: {
    ZeropoolEvent: {
      _enum: {
        Message: '(u32, u32, Vec<u8>)',
      }
    }
  }
})
// FIXME: Find a better way to initialize the library
export let keyring: Keyring
export let keypair: KeyringPair

export async function initPolkadot() {
  await cryptoWaitReady()
  await api.isReadyOrError
  keyring = new Keyring({ type: 'sr25519' })
  keypair = keyring.addFromUri(RELAYER_ADDRESS_PRIVATE_KEY)
}

function transformEvent(ev: any): MessageEvent {
  let [poolIndex, allMessagesHash, outCommit, data] = ev.data.toJSON() as any
  throw new Error('unimplemented')
  return { data, transactionHash: '' }
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

      events.forEach((record: any) => {
        const ev = record.event
        if (ev.section == 'zeropool' && ev.method == 'Message') {
          const event = transformEvent(ev)
          // logger.debug('Found zeropool Message event (index %o)', event.poolIndex)
          pastEvents.push(event)
        }
      })
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
  api.query.system.events((events: any) => {
    logger.debug(`Received ${events.length} events:`)

    events.forEach((record: any) => {
      const { event: ev } = record;
      if (ev.section == 'zeropool' && ev.method == 'Message') {
        const event = transformEvent(ev)
        // logger.info(`New Message event at ${event.poolIndex}`)
        handler(event)
      }
    })
  })
}
