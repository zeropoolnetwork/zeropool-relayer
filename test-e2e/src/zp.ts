import Web3 from 'web3'
import { Buffer } from 'buffer'
import { toBN } from 'web3-utils'
import { decodeMemo } from 'zp-memo-parser'
import TokenAbi from './token-abi.json'
import { postData, numToHex, fakeTxProof, packSignature } from './utils'
import { rpcUrl, relayerUrl, tokenAddress, zpAddress, clientPK, energyAddress } from './constants.json'
import { UserAccount, UserState, getConstants, Helpers, IWithdrawData, IDepositData, ITransferData } from 'libzeropool-rs-wasm-bundler'

const expect = chai.expect
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

export async function syncAccounts(accounts: UserAccount[]) {
  for (const account of accounts) {
    console.log('syncing')
    await syncNotesAndAccount(account)
  }
}

export async function syncNotesAndAccount(account: UserAccount, numTxs = 20n, offset = 0n) {
  const txs = await fetch(
    `${relayerUrl}/transactions/${numTxs.toString()}/${offset.toString()}`
  ).then(r => r.json())

  // Extract user's accounts and notes from memo blocks
  for (let txNum = 0; txNum <= txs.length; txNum++) {
    const tx = txs[txNum]
    if (!tx) continue

    // @ts-ignore
    accountToDelta[account] = (txNum + 1) * 128

    // little-endian
    const commitment = Uint8Array.from(tx.data.slice(0, 32)).reverse()
    console.log('Memo commit', Helpers.numToStr(commitment))
    account.addCommitment(BigInt(txNum), commitment)

    const buf = Uint8Array.from(tx.data.slice(32))

    console.log(buf.toString().slice(0, 100))
    console.log(buf.length)

    const memo = decodeMemo(Buffer.from(buf), null);
    const hashes = [memo.accHash].concat(memo.noteHashes).map(Helpers.numToStr)

    const numLeafs = BigInt(constants.OUT + 1)
    const accountOffset = BigInt(offset + BigInt(txNum) * numLeafs)

    const pair = account.decryptPair(buf)
    if (pair) {
      console.log(pair.account)
      account.addAccount(accountOffset, hashes, pair.account, [])
    }

    const notes = account.decryptNotes(buf)
      .filter(({ note }) => note.b !== '0')
      .map(({ note, index }) => {
        return {
          note,
          index: parseInt(accountOffset.toString()) + 1 + index
        }
      })
    if (notes.length > 0) {
      console.log(notes)
      account.addNotes(accountOffset, hashes, notes)
    }
  }
}

async function proofAndSend(mergeTx: any, fake: boolean, txType: string, depositSignature: string | null) {
  let data
  if (fake) {
    data = {
      proof: {
        inputs: [
          mergeTx.public.root,
          mergeTx.public.nullifier,
          mergeTx.public.out_commit,
          mergeTx.public.delta,
          mergeTx.public.memo,
        ],
        ...fakeTxProof
      },
    }
  } else {
    console.log('Getting proof from relayer...')
    const proof = await postData(`${relayerUrl}/proof_tx`, { pub: mergeTx.public, sec: mergeTx.secret })
      .then(r => r.json())
    console.log('Got tx proof', proof)

    data = {
      proof,
    }
  }

  data = {
    ...data,
    memo: mergeTx.memo,
    txType,
    depositSignature,
  }

  await postData(`${relayerUrl}/transaction`, data)
    .then(data => {
      console.log(data)
    })
}

export async function createAccount(sk: number[]) {
  const state = await UserState.init("any user identifier")
  const account = new UserAccount(Uint8Array.from(sk), state)
  return account
}

export async function deposit(account: UserAccount, from: string, amount: string, fake = false) {
  const amounBN = toBN(amount)
  console.log('Approving tokens...')
  await token.methods.approve(zpAddress, amounBN.mul(denominator)).send({ from })
  console.log('Making a deposit...')
  const deposit: IDepositData = {
    fee: '0',
    amount,
  }
  const mergeTx = await account.createDeposit(deposit)
  const depositSignature = web3.eth.accounts.sign(
    numToHex(web3, mergeTx.public.nullifier),
    clientPK
  )
  await proofAndSend(mergeTx, fake, '00', packSignature(depositSignature))
  return mergeTx
}

export async function transfer(account: UserAccount, to: string, amount: string, fake = false) {
  console.log('Making a transfer...')
  const transfer: ITransferData = {
    fee: '0',
    outputs: [{ to, amount }]
  }
  const mergeTx = await account.createTransfer(transfer)
  await proofAndSend(mergeTx, fake, '01', null)
  return mergeTx
}

export async function withdraw(account: UserAccount, to: Uint8Array, amount: string, energy_amount: string, fake = false) {
  console.log('Making a withdraw...')
  const withdraw: IWithdrawData = {
    fee: '0',
    amount,
    to,
    native_amount: '0',
    energy_amount,
  }
  const mergeTx = await account.createWithdraw(withdraw)
  await proofAndSend(mergeTx, fake, '02', null)
  return mergeTx
}
