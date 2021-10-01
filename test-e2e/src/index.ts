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
  getEnergyBalance
} from './zp'

const expect = chai.expect

describe('ZP client', () => {
  describe('Simple user flow', () => {
    let mergeTx
    let balanceDiff
    let energyBalance
    it('can deposit-transfer-withdraw', async () => {
      const minter = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
      const from = '0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0'

      const account = await createAccount([1, 2, 3])
      const accountOther = await createAccount([4, 5, 6])

      await syncAccounts([account, accountOther])

      expect(account.totalBalance()).eq('0')
      expect(accountOther.totalBalance()).eq('0')

      // Give 10 tokens
      balanceDiff = await getBalanceDiff(from, async () => {
        await token.methods.mint(from, denominator.mul(toBN(10)).toString()).send({ from: minter })
      })
      expect(balanceDiff).eq(denominator.mul(toBN(10)).toString())

      // Deposit
      balanceDiff = await getBalanceDiff(from, async () => {
        mergeTx = await deposit(account, from, '5')
      })
      await syncAccounts([account, accountOther])

      expect(balanceDiff).eq(denominator.mul(toBN(-5)).toString())
      expect(account.totalBalance()).eq('5')
      expect(accountOther.totalBalance()).eq('0')

      // Transfer
      mergeTx = await transfer(account, accountOther.generateAddress(), '1')
      await syncAccounts([account, accountOther])

      expect(account.totalBalance()).eq('4')
      expect(accountOther.totalBalance()).eq('1')

      // Withdraw from first account
      balanceDiff = await getBalanceDiff(from, async () => {
        mergeTx = await withdraw(account, addressToUint8(from), '2')
      })
      await syncAccounts([account, accountOther])

      energyBalance = await getEnergyBalance(from)
      expect(energyBalance).eq(denominator.mul(toBN(1152)).toString())

      expect(balanceDiff).eq(denominator.mul(toBN(2)).toString())
      expect(account.totalBalance()).eq('2')
      expect(accountOther.totalBalance()).eq('1')

      // Withdraw from second account
      balanceDiff = await getBalanceDiff(from, async () => {
        mergeTx = await withdraw(accountOther, addressToUint8(from), '1')
      })
      await syncAccounts([account, accountOther])

      energyBalance = await getEnergyBalance(from)
      // 1152 from previous + 255 from this one
      expect(energyBalance).eq(denominator.mul(toBN(1407)).toString())

      expect(balanceDiff).eq(denominator.mul(toBN(1)).toString())
      expect(account.totalBalance()).eq('2')
      expect(accountOther.totalBalance()).eq('0')

    });
  });
});

mocha.run()