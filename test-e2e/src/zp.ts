import Web3 from 'web3'
import { toBN } from 'web3-utils'
import { UserAccount, UserState, Params } from 'libzeropool-rs-wasm-bundler';
import TokenAbi from './token-abi.json'
import { base64ToArrayBuffer, sleep, deleteDb, postData, concatArrays, numToHex, fakeTxProof, packSignature } from './utils'

export function syncAcc(account: UserAccount, tx: any, n: number) {
  let buf = base64ToArrayBuffer(tx.ciphertext)
  const acc_notes = account.decryptPair(buf)
  const acc = acc_notes.account
  let cur = n * 128
  account.addAccount(BigInt(cur), acc)

  tx.out_hashes.slice(1).forEach((h: string) => {
    cur += 1
    account.addMerkleLeaf(BigInt(cur), h)
  })

  console.log('Account balance', account.totalBalance())
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
    let rawProof = Uint8Array.from([])
    console.log('Getting proof from relayer...')
    await postData('http://localhost:8000/proof_tx', { pub: mergeTx.public, sec: mergeTx.secret })
      .then(async response => {
        const reader = response.body.getReader()
        let f = false
        while (!f) {
          const { done, value } = await reader.read()
          if (value) rawProof = concatArrays([rawProof, value])
          f = done
        }
      })
    const proof = JSON.parse(new TextDecoder().decode(rawProof))
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

  await postData('http://localhost:8000/transaction', data)
    .then(data => {
      console.log(data)
    })
}

// Default from ganache
const privateKey = '0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1'

export const web3 = new Web3('ws://127.0.0.1:8545')
export const CONTRACT_ADDRESS = '0xd833215cbcc3f914bd1c9ece3ee7bf8b14f841bb'
export const TOKEN_ADDRESS = '0x254dffcd3277c0b1660f6d42efbb754edababc2b'
export const token = new web3.eth.Contract(TokenAbi as any, TOKEN_ADDRESS)
export const denominator = toBN(1000000000)
const zero_fee = new Uint8Array(8).fill(0)
const zero_amount = new Uint8Array(8).fill(0)

export async function getTokenBalance(address: string) {
  return await token.methods.balanceOf(address).call()
}

export async function init() {
  await deleteDb('smt')
  await deleteDb('txs')
}

export async function createAccount() {
  const state = await UserState.init("any user identifier")
  const account = new UserAccount(Uint8Array.from([1, 2, 3]), state)
  return account
}

export async function deposit(account: UserAccount, from: string, amount: string, fake = false) {
  const amounBN = toBN(amount)
  console.log('Approving tokens...')
  await token.methods.approve(CONTRACT_ADDRESS, amounBN.mul(denominator)).send({ from })
  console.log('Making a deposit...')
  const mergeTx = await account.createTx('deposit', amount, zero_fee)
  const depositSignature = web3.eth.accounts.sign(
    numToHex(web3, mergeTx.public.nullifier),
    privateKey
  )
  await proofAndSend(mergeTx, fake, '00', packSignature(depositSignature))
  return mergeTx
}

export async function transfer(account: UserAccount, to: string, amount: string, fake = false) {
  console.log('Making a transfer...')
  const mergeTx = await account.createTx('transfer', [{ to, amount }], zero_fee)
  await proofAndSend(mergeTx, fake, '01', null)
  return mergeTx
}

export async function withdraw(account: UserAccount, to: Uint8Array, amount: string, fake = false) {
  const withdraw_data = concatArrays([zero_fee, zero_amount, to])
  console.log('Making a withdraw...')
  const mergeTx = await account.createTx('withdraw', amount, withdraw_data)
  await proofAndSend(mergeTx, fake, '02', null)
  return mergeTx
}
