import Web3 from 'web3'
import { toBN } from 'web3-utils'
import { Sign } from 'web3-core'

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function deleteDb(type: string) {
  return new Promise(resolve => {
    const DBDeleteRequest = window.indexedDB.deleteDatabase(`zeropool.any user identifier.${type}`)

    DBDeleteRequest.onerror = function (event) {
      console.log('Error deleting database.')
    }

    DBDeleteRequest.onsuccess = function (event) {
      console.log('Database deleted successfully')
      resolve(null)
    }
  })
}

export async function postData(url = '', data = {}) {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return response
}

export function base64ToArrayBuffer(base64: string) {
  var binary_string = window.atob(base64)
  var len = binary_string.length
  var bytes = new Uint8Array(len)
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i)
  }
  return bytes
}

export function concatArrays(arrs: Uint8Array[]) {
  let mergedArr = Uint8Array.from([])
  arrs.forEach(arr => {
    const temp = new Uint8Array(mergedArr.length + arr.length)
    temp.set(mergedArr, 0)
    temp.set(arr, mergedArr.length)
    mergedArr = temp
  })
  return mergedArr
}

export function numToHex(web3: Web3, n: string, pad = 64) {
  let num = toBN(n)
  if (num.isNeg()) {
    let a = toBN(2).pow(toBN(pad * 4))
    num = a.sub(num.neg())
  }
  const hex = web3.utils.numberToHex(num)
  return web3.utils.padLeft(hex, pad)
}

export const fakeTxProof = {
  proof: {
    a: [
      '11533315366764172207830942257467815827048793486992167376211289220451677858288',
      '9051134181781801742358171403867869806562829238281402507597064540637910203283',
    ],
    b: [
      [
        '18609120563600037123419512189775243105933213240800331912120122212275609473846',
        '3148915420279216102962402497491657935506296850250565082890727085711272506839',
      ],
      [
        '8286759449287410580951139622949521891267413943714983116775401439986159085019',
        '15112660445821233345582274001262056139037809009471745698629040416090314928402',
      ],
    ],
    c: [
      '16109195311773355344754904911413881685975026855053019185842214839287168009132',
      '6933299401563952246769670084615710145828268970091749539762911165266677753491',
    ],
  },
}

export function packSignature(sign: Sign) {
  const vBit = toBN(sign.v).isEven()
  const r = toBN(sign.r)
  const s = toBN(sign.s)
  if (vBit) s.iadd(toBN(2).pow(toBN(255)))
  return '0x' + r.toString('hex') + s.toString('hex')
}

export function addressToUint8(address: string) {
  return Uint8Array.from(Web3.utils.hexToBytes(address))
}
