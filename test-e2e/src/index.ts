import BN from 'bn.js'
import CBN from 'chai-bn'
import { toBN } from 'web3-utils'
import { sleep, addressToUint8 } from './utils'
import { relayerUrlFirst, relayerUrlSecond } from './constants.json'
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
} from './zp'

chai.use(CBN(BN))
const expect = chai.expect

describe('ZP client', () => {
  describe('Simple user flow', () => {
    let mergeTx

    let energyBalanceBefore: BN
    let energyBalanceAfter: BN
    let energyDiff: BN

    let tokenBalanceBefore: BN
    let tokenBalanceAfter: BN
    let balanceDiff: BN

    const from = '0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0'
    const minter = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
    it('can deposit-transfer-withdraw with two relayers', async () => {
      const account = await createAccount([1, 2, 3], '123')
      const accountOther = await createAccount([4, 5, 6], '456')

      let curRelayer = relayerUrlFirst

      await syncAccounts([account, accountOther], curRelayer)

      expect(account.totalBalance()).eq('0')
      expect(accountOther.totalBalance()).eq('0')

      // Give 10 tokens
      balanceDiff = await getBalanceDiff(from, async () => {
        await token.methods.mint(from, denominator.mul(toBN(10)).toString()).send({ from: minter })
      })
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(10)))

      // Deposit
      tokenBalanceBefore = await getTokenBalance(from)
      mergeTx = await deposit(account, from, '5', curRelayer)

      // Wait until deposit is processed
      await sleep(17000)

      curRelayer = relayerUrlSecond

      await syncAccounts([account, accountOther], curRelayer)
      tokenBalanceAfter = await getTokenBalance(from)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(-5)))
      expect(account.totalBalance()).eq('5')
      expect(accountOther.totalBalance()).eq('0')

      // Transfer
      mergeTx = await transfer(account, accountOther.generateAddress(), '1', curRelayer)

      // Wait until transfer is processed
      await sleep(17000)

      await syncAccounts([account, accountOther], curRelayer)

      expect(account.totalBalance()).eq('4')
      expect(accountOther.totalBalance()).eq('1')

      tokenBalanceBefore = await getTokenBalance(from)
      energyBalanceBefore = await getEnergyBalance(from)
      // Withdraw from first account
      // Total 1152 energy
      mergeTx = await withdraw(account, addressToUint8(from), '2', '500', curRelayer)

      curRelayer = relayerUrlFirst

      // Withdraw from second account
      // Total 127 energy
      mergeTx = await withdraw(accountOther, addressToUint8(from), '1', '55', curRelayer)

      // Wait until both withdrawals are processed
      await sleep(35000)

      await syncAccounts([account, accountOther], curRelayer)
      tokenBalanceAfter = await getTokenBalance(from)
      energyBalanceAfter = await getEnergyBalance(from)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      // 2 from first + 1 from second
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(3)))
      expect(account.totalBalance()).eq('2')
      expect(accountOther.totalBalance()).eq('0')

      energyDiff = energyBalanceAfter.sub(energyBalanceBefore)
      expect(energyDiff).bignumber.eq(denominator.mul(toBN(555)))
    })

    it('can deposit-transfer-withdraw', async () => {
      const account = await createAccount([7, 8, 9], '789')
      const accountOther = await createAccount([10, 11, 12], '101112')

      await syncAccounts([account, accountOther])

      expect(account.totalBalance()).eq('0')
      expect(accountOther.totalBalance()).eq('0')

      // Give 10 tokens
      balanceDiff = await getBalanceDiff(from, async () => {
        await token.methods.mint(from, denominator.mul(toBN(10)).toString()).send({ from: minter })
      })
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(10)))

      // Deposit
      tokenBalanceBefore = await getTokenBalance(from)
      mergeTx = await deposit(account, from, '5')

      // Wait until deposit is processed
      await sleep(17000)

      await syncAccounts([account, accountOther])
      tokenBalanceAfter = await getTokenBalance(from)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(-5)))
      expect(account.totalBalance()).eq('5')
      expect(accountOther.totalBalance()).eq('0')

      // Transfer
      mergeTx = await transfer(account, accountOther.generateAddress(), '1')

      // Wait until transfer is processed
      await sleep(17000)

      await syncAccounts([account, accountOther])

      expect(account.totalBalance()).eq('4')
      expect(accountOther.totalBalance()).eq('1')

      tokenBalanceBefore = await getTokenBalance(from)
      energyBalanceBefore = await getEnergyBalance(from)
      // Withdraw from first account
      // Total 1152 energy
      mergeTx = await withdraw(account, addressToUint8(from), '2', '400')

      // Withdraw from second account
      // Total 127 energy
      mergeTx = await withdraw(accountOther, addressToUint8(from), '1', '42')

      // Wait until both withdrawals are processed
      await sleep(35000)

      await syncAccounts([account, accountOther])
      tokenBalanceAfter = await getTokenBalance(from)
      energyBalanceAfter = await getEnergyBalance(from)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      // 2 from first + 1 from second
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(3)))
      expect(account.totalBalance()).eq('2')
      expect(accountOther.totalBalance()).eq('0')

      energyDiff = energyBalanceAfter.sub(energyBalanceBefore)
      expect(energyDiff).bignumber.eq(denominator.mul(toBN(442)))
    })
  })
})

mocha.run()
