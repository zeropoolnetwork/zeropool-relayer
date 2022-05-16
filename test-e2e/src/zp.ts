import Web3 from 'web3'
import { Buffer } from 'buffer'
import { toBN } from 'web3-utils'
import { decodeMemo } from 'zp-memo-parser'
import TokenAbi from './token-abi.json'
import { postData, numToHex, fakeTxProof, packSignature } from './utils'
import { rpcUrl, relayerUrlFirst, tokenAddress, zpAddress, clientPK, energyAddress } from './constants.json'
import { UserAccount, UserState, getConstants, Helpers, IWithdrawData, IDepositData, ITransferData, Proof, Params } from 'libzeropool-rs-wasm-bundler'

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

export async function syncAccounts(accounts: UserAccount[], relayerUrl = relayerUrlFirst) {
  for (const account of accounts) {
    console.log('syncing')
    await syncNotesAndAccount(account, relayerUrl)
  }
}

export async function syncNotesAndAccount(account: UserAccount, relayerUrl = relayerUrlFirst, numTxs = 20n, offset = 0n) {
  const txs = await fetch(
    `${relayerUrl}/transactions?limit=${numTxs.toString()}&offset=${offset.toString()}`
  ).then(r => r.json())

  // Extract user's accounts and notes from memo blocks
  for (let txNum = 0; txNum <= txs.length; txNum++) {
    const tx = txs[txNum]
    if (!tx) continue

    // @ts-ignore
    accountToDelta[account] = (txNum + 1) * 128

    console.log('tx', tx)
    const buf = Buffer.from(tx, 'hex')
    console.log(buf.buffer)

    // little-endian
    const commitment = new Uint8Array(buf.buffer.slice(0, 32)).reverse()
    console.log(commitment)
    console.log('Memo commit', Helpers.numToStr(commitment))
    account.addCommitment(BigInt(txNum), commitment)

    const memo = new Uint8Array(buf.buffer.slice(32))

    console.log(memo.toString().slice(0, 100))
    console.log(memo.length)

    const memoFields = decodeMemo(Buffer.from(memo), null);
    const hashes = [memoFields.accHash].concat(memoFields.noteHashes).map(Helpers.numToStr)

    const numLeafs = BigInt(constants.OUT + 1)
    const accountOffset = BigInt(offset + BigInt(txNum) * numLeafs)

    const pair = account.decryptPair(memo)
    if (pair) {
      console.log(pair.account)
      account.addAccount(accountOffset, hashes, pair.account, [])
    }

    const notes = account.decryptNotes(memo)
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

async function proofAndSend(mergeTx: any, fake: boolean, txType: string, depositSignature: string | null, relayerUrl: string) {
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

export async function createAccount(sk: number[], stateId: string) {
  const state = await UserState.init(stateId)
  const account = new UserAccount(Uint8Array.from(sk), state)
  return account
}

async function signAndSend(to: string, data: string) {
  const serializedTx = await web3.eth.accounts.signTransaction(
    {
      to,
      data,
      gas: '1000000'
    },
    clientPK
  )

  return new Promise((res, rej) =>
    web3.eth
      .sendSignedTransaction(serializedTx.rawTransaction as string)
      .once('transactionHash', res)
      .once('error', rej)
  )
}

export async function deposit(account: UserAccount, from: string, amount: string, relayerUrl = relayerUrlFirst, fake = false) {
  const amounBN = toBN(amount)
  console.log('Approving tokens...')
  const data = token.methods.approve(zpAddress, amounBN.mul(denominator)).encodeABI()
  await signAndSend(tokenAddress, data)
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
  await proofAndSend(mergeTx, fake, '0000', packSignature(depositSignature), relayerUrl)
  return mergeTx
}

export async function transfer(account: UserAccount, to: string, amount: string, relayerUrl = relayerUrlFirst, fake = false) {
  console.log('Making a transfer...')
  const transfer: ITransferData = {
    fee: '0',
    outputs: [{ to, amount }]
  }
  const mergeTx = await account.createTransfer(transfer)
  await proofAndSend(mergeTx, fake, '0001', null, relayerUrl)
  return mergeTx
}

export async function withdraw(account: UserAccount, to: Uint8Array, amount: string, energy_amount: string, relayerUrl = relayerUrlFirst, fake = false) {
  console.log('Making a withdraw...')
  const withdraw: IWithdrawData = {
    fee: '0',
    amount,
    to,
    native_amount: '0',
    energy_amount,
  }
  const mergeTx = await account.createWithdraw(withdraw)
  await proofAndSend(mergeTx, fake, '0002', null, relayerUrl)
  return mergeTx
}
