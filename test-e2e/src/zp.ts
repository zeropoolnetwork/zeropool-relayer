import Web3 from 'web3'
import { Buffer } from 'buffer'
import { toBN } from 'web3-utils'
import { decodeMemo } from '../../common/memo'
import TokenAbi from './token-abi.json'
import { postData, concatArrays, numToHex, fakeTxProof, packSignature } from './utils'
import { rpcUrl, relayerUrl, tokenAddress, zpAddress, clientPK, energyAddress } from './constants.json'
import { UserAccount, UserState, getConstants, Helpers } from 'libzeropool-rs-wasm-bundler'

const expect = chai.expect
export const web3 = new Web3(rpcUrl)
export const token = new web3.eth.Contract(TokenAbi as any, tokenAddress)
export const energyToken = new web3.eth.Contract(TokenAbi as any, energyAddress)
export const denominator = toBN(1000000000)
const zero_fee = new Uint8Array(8).fill(0)
const zero_amount = new Uint8Array(8).fill(0)
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

    const numLeafs = BigInt(constants.OUT + 1)
    const accountOffset = BigInt(offset + BigInt(txNum) * numLeafs)

    let found = false
    const pair = account.decryptPair(buf)
    if (pair) {
      account.addAccount(accountOffset, pair.account)
      found = true
    }

    const notes = account.decryptNotes(buf)
    for (const n of notes) {
      if (!n) continue
      const noteIndex = accountOffset + 1n + BigInt(n.index)
      account.addReceivedNote(noteIndex, n.note)
      found = true
    }

    if (found) {
      console.log('Found assets for account')
      console.log('Decoding memo')
      try {
        const memo = decodeMemo(Buffer.from(buf), null);
        const hashes = [memo.accHash].concat(memo.noteHashes)
        hashes
          .map(Helpers.numToStr)
          .forEach((hash, i) => {
            account.addMerkleLeaf(accountOffset + BigInt(i), hash)
          })
      } catch (error) {
        console.log(error)
      }
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

async function createTx(account: UserAccount, type: string, value: any, data: Uint8Array) {
  // @ts-ignore
  const index = accountToDelta[account] || 0
  const mergeTx = await account.createTx(type, value, data, BigInt(index))
  console.log('Delta', mergeTx.parsed_delta)
  return mergeTx
}

export async function deposit(account: UserAccount, from: string, amount: string, fake = false) {
  const amounBN = toBN(amount)
  console.log('Approving tokens...')
  await token.methods.approve(zpAddress, amounBN.mul(denominator)).send({ from })
  console.log('Making a deposit...')
  const mergeTx = await createTx(account, 'deposit', amount, zero_fee)
  const depositSignature = web3.eth.accounts.sign(
    numToHex(web3, mergeTx.public.nullifier),
    clientPK
  )
  await proofAndSend(mergeTx, fake, '00', packSignature(depositSignature))
  return mergeTx
}

export async function transfer(account: UserAccount, to: string, amount: string, fake = false) {
  console.log('Making a transfer...')
  const mergeTx = await createTx(account, 'transfer', [{ to, amount }], zero_fee)
  await proofAndSend(mergeTx, fake, '01', null)
  return mergeTx
}

export async function withdraw(account: UserAccount, to: Uint8Array, amount: string, fake = false) {
  const withdraw_data = concatArrays([zero_fee, zero_amount, to])
  console.log('Making a withdraw...')
  const mergeTx = await createTx(account, 'withdraw', amount, withdraw_data)
  await proofAndSend(mergeTx, fake, '02', null)
  return mergeTx
}
