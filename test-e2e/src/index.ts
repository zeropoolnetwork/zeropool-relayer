import { createAccount, deposit, transfer, withdraw, syncAcc, getTokenBalance, denominator } from './zp'
import { sleep, addressToUint8 } from './utils'
import { toBN } from 'web3-utils'

const assert = chai.assert
const expect = chai.expect

describe('ZP client', () => {
  describe('Simple user flow', () => {
    it('can deposit-transfer-withdraw', async () => {
      const from = '0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0'

      const account = await createAccount()
      const accountOther = await createAccount()

      let ZPBalance = account.totalBalance()
      expect(ZPBalance).eq('0')

      let tokenBalance = await getTokenBalance(from)
      expect(tokenBalance).eq(denominator.mul(toBN(10)).toString())

      let mergeTx
      mergeTx = await deposit(account, from, '2')
      syncAcc(account, mergeTx, 0)

      ZPBalance = account.totalBalance()
      expect(ZPBalance).eq('2')

      tokenBalance = await getTokenBalance(from)
      expect(tokenBalance).eq(denominator.mul(toBN(8)).toString())


      await sleep(10000)

      mergeTx = await transfer(account, accountOther.generateAddress(), '1')
      syncAcc(account, mergeTx, 1)

      ZPBalance = account.totalBalance()
      expect(ZPBalance).eq('1')

      await sleep(10000)

      mergeTx = await withdraw(account, addressToUint8(from), '1')
      syncAcc(account, mergeTx, 2)
      ZPBalance = account.totalBalance()
      expect(ZPBalance).eq('0')

      tokenBalance = await getTokenBalance(from)
      expect(tokenBalance).eq(denominator.mul(toBN(9)).toString())

      assert.equal(true, true)
    });
  });
});

mocha.run()