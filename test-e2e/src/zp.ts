import Web3 from 'web3'
import { toBN } from 'web3-utils'
import { UserAccount, UserState, getConstants } from 'libzeropool-rs-wasm-bundler';
import TokenAbi from './token-abi.json'
import { postData, concatArrays, numToHex, fakeTxProof, packSignature } from './utils'
import { rpcUrl, relayerUrl, tokenAddress, zpAddress, clientPK, energyAddress } from './constants.json'

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
  return await token.methods.balanceOf(address).call()
}

export async function getEnergyBalance(address: string) {
  return await energyToken.methods.balanceOf(address).call()
}

export async function getBalanceDiff(address: string, f: Function) {
  const balanceBefore = await getTokenBalance(address)
  await f()
  const balanceAfter = await getTokenBalance(address)
  return toBN(balanceAfter).sub(toBN(balanceBefore)).toString()
}

export async function syncAccounts(accounts: UserAccount[]) {
  for (const account of accounts) {
    console.log("syncing")
    await syncNotesAndAccount(account)
  }
}

export async function syncNotesAndAccount(account: UserAccount, numTxs = 20n, offset = 0n) {
  const txs = await fetch(
    `${relayerUrl}/transactions/${numTxs.toString()}/${offset.toString()}`
  ).then(r => r.json())

  // Extract user's accounts and notes from memo blocks
  const indices = []
  for (let txNum = 0; txNum <= txs.length; txNum++) {
    const tx = txs[txNum]
    if (!tx) continue

    // First 32 bytes is nullifier
    const buf = Uint8Array.from(tx.data.slice(32))

    const numLeafs = BigInt(constants.OUT + 1)
    const accountOffset = BigInt(offset + BigInt(txNum) * numLeafs)

    const pair = account.decryptPair(buf)
    if (pair) {
      account.addAccount(accountOffset, pair.account)
      indices.push(accountOffset.toString())
    }

    const notes = account.decryptNotes(buf)

    for (const n of notes) {
      if (!n) continue
      const noteIndex = accountOffset + 1n + BigInt(n.index)
      account.addReceivedNote(noteIndex, n.note)
      indices.push(noteIndex.toString())
    }
  }

  const { proofs, root, deltaIndex } = await getMerkleProofs(indices)
  expect(proofs.length).eq(indices.length)

  for (let i = 0; i < proofs.length; i++) {
    const proof = proofs[i]
    const index = indices[i]
    if (proof) account.addMerkleProof(BigInt(index), proof.sibling)
  }
  account.addMerkleSubtreeRoot(constants.HEIGHT, 0n, root)

  // @ts-ignore
  accountToDelta[account] = deltaIndex
}

async function getMerkleProofs(indeces: (string | number)[]) {
  const query = indeces.reduce((prev, cur) => `${prev}&index=${cur}`, '')
  const proofs = await fetch(`${relayerUrl}/merkle/proof?${query}`).then(r => r.json())
  return proofs
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
