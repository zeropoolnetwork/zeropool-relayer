import Web3 from 'web3'
import { Buffer } from 'buffer'
import { toBN } from 'web3-utils'
import { decodeMemo } from 'zp-memo-parser'
import TokenAbi from './token-abi.json'
import { postData, numToHex, fakeTxProof, packSignature } from './utils'
import { rpcUrl, relayerUrl, tokenAddress, zpAddress, energyAddress } from './constants.json'
import {
  UserAccount,
  UserState,
  getConstants,
  Helpers,
  IWithdrawData,
  IDepositData,
  ITransferData,
  Proof,
  Params,
} from 'libzeropool-rs-wasm-bundler'

export const web3 = new Web3(rpcUrl)
export const token = new web3.eth.Contract(TokenAbi as any, tokenAddress)
export const energyToken = new web3.eth.Contract(TokenAbi as any, energyAddress)
export const denominator = toBN(1000000000)
const constants = getConstants()
const accountToDelta = {}

export async function getTokenBalance(address: string) {
  return toBN(await token.methods.balanceOf(address).call())
}

export async function getEnergyBalance(address: string) {
  return toBN(await energyToken.methods.balanceOf(address).call())
}

export async function getBalanceDiff(address: string, f: Function) {
  const balanceBefore = await getTokenBalance(address)
  await f()
  const balanceAfter = await getTokenBalance(address)
  return balanceAfter.sub(balanceBefore)
}

export async function syncAccounts(accounts: UserAccount[], optimistic = true) {
  for (const account of accounts) {
    console.log('syncing')
    await syncNotesAndAccount(account, { optimistic })
  }
}

interface SyncAccountsOptions {
  limit?: bigint
  offset?: bigint
  optimistic: boolean
}

export async function syncNotesAndAccount(
  account: UserAccount,
  { limit = 20n, offset = 0n, optimistic = true }: SyncAccountsOptions
) {
  let url = `${relayerUrl}/transactions?limit=${limit.toString()}&offset=${offset.toString()}`
  if (optimistic) url += '&optimistic=true'

  const txs = await fetch(url).then(r => r.json())

  console.log(`Received ${txs.length} transactions`)

  // Extract user's accounts and notes from memo blocks
  for (let txNum = 0; txNum <= txs.length; txNum++) {
    const tx = txs[txNum]
    if (!tx) continue

    // @ts-ignore
    accountToDelta[account] = (txNum + 1) * 128

    const buf = Buffer.from(tx, 'hex')

    // little-endian
    const commitment = new Uint8Array(buf.buffer.slice(0, 32)).reverse()
    account.addCommitment(BigInt(txNum), commitment)

    const memo = new Uint8Array(buf.buffer.slice(64))

    const memoFields = decodeMemo(Buffer.from(memo), null)
    const hashes = [memoFields.accHash].concat(memoFields.noteHashes).map(Helpers.numToStr)

    const numLeafs = BigInt(constants.OUT + 1)
    const accountOffset = BigInt(offset + BigInt(txNum) * numLeafs)

    const pair = account.decryptPair(memo)
    if (pair) {
      account.addAccount(accountOffset, hashes, pair.account, [])
    }

    const notes = account
      .decryptNotes(memo)
      .filter(({ note }) => note.b !== '0')
      .map(({ note, index }) => {
        return {
          note,
          index: parseInt(accountOffset.toString()) + 1 + index,
        }
      })
    if (notes.length > 0) {
      account.addNotes(accountOffset, hashes, notes)
    }
  }
}

interface SendTx {
  proof: any
  memo: string
  txType: string
  depositSignature: string | null
}

async function proofTx(mergeTx: any, fake: boolean) {
  let proof
  if (fake) {
    proof = {
      inputs: [
        mergeTx.public.root,
        mergeTx.public.nullifier,
        mergeTx.public.out_commit,
        mergeTx.public.delta,
        mergeTx.public.memo,
      ],
      ...fakeTxProof,
    }
  } else {
    console.log('Getting proof from relayer...')
    proof = await postData(`${relayerUrl}/proof_tx`, {
      pub: mergeTx.public,
      sec: mergeTx.secret,
    }).then(r => r.json())
    console.log('Received tx proof')
  }

  return proof
}

export async function sendTx(sendTxData: SendTx) {
  return await postData(`${relayerUrl}/sendTransactions`, sendTxData).then(data => {
    console.log(data)
  })
}

export async function createAccount(id: number) {
  const sk = [id]
  const stateId = id.toString()
  const state = await UserState.init(stateId)
  const zkAccount = new UserAccount(Uint8Array.from(sk), state)
  return zkAccount
}

export async function approve(amount: string, from: string) {
  console.log('Approving tokens...')
  await token.methods.approve(zpAddress, toBN(amount).mul(denominator)).send({ from })
}

export async function deposit(account: UserAccount, amount: string, pk: string, fake = false): Promise<SendTx> {
  console.log('Making a deposit...')
  const deposit: IDepositData = {
    fee: '0',
    amount,
  }
  const mergeTx = await account.createDeposit(deposit)
  const depositSignature = packSignature(web3.eth.accounts.sign(numToHex(web3, mergeTx.public.nullifier), pk))
  const proof = await proofTx(mergeTx, fake)
  return {
    proof,
    memo: mergeTx.memo,
    depositSignature,
    txType: '0000',
  }
}

export async function transfer(account: UserAccount, to: string, amount: string, fake = false): Promise<SendTx> {
  console.log('Making a transfer...')
  const transfer: ITransferData = {
    fee: '0',
    outputs: [{ to, amount }],
  }
  const mergeTx = await account.createTransfer(transfer)

  const proof = await proofTx(mergeTx, fake)
  return {
    proof,
    memo: mergeTx.memo,
    depositSignature: null,
    txType: '0001',
  }
}

export async function withdraw(
  account: UserAccount,
  to: Uint8Array,
  amount: string,
  energy_amount: string,
  fake = false
): Promise<SendTx> {
  console.log('Making a withdraw...')
  const withdraw: IWithdrawData = {
    fee: '0',
    amount,
    to,
    native_amount: '0',
    energy_amount,
  }
  const mergeTx = await account.createWithdraw(withdraw)
  const proof = await proofTx(mergeTx, fake)
  return {
    proof,
    memo: mergeTx.memo,
    depositSignature: null,
    txType: '0002',
  }
}
