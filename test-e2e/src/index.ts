import BN from 'bn.js'
import CBN from 'chai-bn'
import { toBN } from 'web3-utils'
import { sleep, addressToUint8 } from './utils'
import {
  createAccount,
  deposit,
  transfer,
  withdraw,
  getBalanceDiff,
  denominator,
  syncAccounts,
  token,
  getEnergyBalance,
  getTokenBalance,
  sendTx,
  approve,
  web3,
} from './zp'
import { rpcUrl, tokenAddress, zpAddress, clientPK, energyAddress, user1, user2, user3, user4 } from './constants.json'

chai.use(CBN(BN))
const expect = chai.expect

describe('ZP client', () => {
  describe('Simple user flow', () => {
    let mergeTx
    let sendTxData
    let stateId = 0

    let energyBalanceBefore: BN
    let energyBalanceAfter: BN
    let energyDiff: BN

    let tokenBalanceBefore: BN
    let tokenBalanceAfter: BN
    let balanceDiff: BN

    const minter = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'

    it('can deposit-transfer-withdraw with one relayer', async () => {
      const account1 = await createAccount(stateId++)
      const account1Address = user1.address
      const account2 = await createAccount(stateId++)

      await syncAccounts([account1, account2])

      expect(account1.totalBalance()).eq('0')
      expect(account2.totalBalance()).eq('0')

      // Give 10 tokens
      await token.methods.mint(account1Address, denominator.mul(toBN(10)).toString()).send({ from: minter })

      // Deposit
      tokenBalanceBefore = await getTokenBalance(account1Address)

      await approve('5', account1Address)
      sendTxData = await deposit(account1, '5', user1.privateKey)
      await sendTx(sendTxData)

      await sleep(17000)

      await syncAccounts([account1, account2])
      tokenBalanceAfter = await getTokenBalance(account1Address)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(-5)))
      expect(account1.totalBalance()).eq('5')

      // Transfer
      sendTxData = await transfer(account1, account2.generateAddress(), '1')
      await sendTx(sendTxData)

      // Wait until transfer is processed
      await sleep(17000)

      await syncAccounts([account1, account2])

      expect(account1.totalBalance()).eq('4')
      expect(account2.totalBalance()).eq('1')

      tokenBalanceBefore = await getTokenBalance(account1Address)
      energyBalanceBefore = await getEnergyBalance(account1Address)
      // Withdraw from first account
      // Total 1152 energy
      sendTxData = await withdraw(account1, addressToUint8(account1Address), '2', '400')
      await sendTx(sendTxData)

      // Withdraw from second account
      // Total 127 energy
      sendTxData = await withdraw(account2, addressToUint8(account1Address), '1', '42')
      await sendTx(sendTxData)

      // Wait until both withdrawals are processed
      await sleep(35000)

      await syncAccounts([account1, account2])
      tokenBalanceAfter = await getTokenBalance(account1Address)
      energyBalanceAfter = await getEnergyBalance(account1Address)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      // 2 from first + 1 from second
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(3)))
      expect(account1.totalBalance()).eq('2')
      expect(account2.totalBalance()).eq('0')

      energyDiff = energyBalanceAfter.sub(energyBalanceBefore)
      expect(energyDiff).bignumber.eq(denominator.mul(toBN(442)))
    })

    it('can process two txs simultaneously', async () => {
      const account1 = await createAccount(stateId++)
      const account2 = await createAccount(stateId++)

      await syncAccounts([account1, account2])

      expect(account1.totalBalance()).eq('0')
      expect(account2.totalBalance()).eq('0')

      // Give 10 tokens
      await token.methods.mint(user3.address, denominator.mul(toBN(10)).toString()).send({ from: minter })
      await token.methods.mint(user4.address, denominator.mul(toBN(10)).toString()).send({ from: minter })
      
      await approve('5', user3.address)
      await approve('4', user4.address)

      console.log(await token.methods.allowance(user1.address, zpAddress).call())
      console.log(await token.methods.allowance(user2.address, zpAddress).call())

      // Deposit
      const sendTxData1 = await deposit(account1, '5', user3.privateKey)
      const sendTxData2 = await deposit(account2, '4', user4.privateKey)

      await Promise.all([sendTx(sendTxData1), sendTx(sendTxData2)])
      
      await sleep(35000)

      await syncAccounts([account1, account2], false)

      expect(account1.totalBalance()).eq('5')
      expect(account2.totalBalance()).eq('4')
    })
  })
})

mocha.run()
