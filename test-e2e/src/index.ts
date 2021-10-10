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
} from './zp'

chai.use(CBN(BN))
const expect = chai.expect

describe('ZP client', () => {
  describe('Simple user flow', () => {
    let mergeTx
    let balanceDiff: BN
    let energyBalance: BN
    let tokenBalanceBefore: BN
    let tokenBalanceAfter: BN
    const from = '0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0'
    const minter = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
    it('can deposit-transfer-withdraw', async () => {
      const account = await createAccount([1, 2, 3])
      const accountOther = await createAccount([4, 5, 6])

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
      await sleep(20000)

      await syncAccounts([account, accountOther])
      tokenBalanceAfter = await getTokenBalance(from)

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(-5)))
      expect(account.totalBalance()).eq('5')
      expect(accountOther.totalBalance()).eq('0')

      // Transfer
      mergeTx = await transfer(account, accountOther.generateAddress(), '1')

      // Wait until transfer is processed
      await sleep(20000)

      await syncAccounts([account, accountOther])

      expect(account.totalBalance()).eq('4')
      expect(accountOther.totalBalance()).eq('1')

      // Withdraw from first account
      tokenBalanceBefore = await getTokenBalance(from)
      mergeTx = await withdraw(account, addressToUint8(from), '2')

      // Withdraw from second account
      mergeTx = await withdraw(accountOther, addressToUint8(from), '1')

      // Wait until both withdrawals are processed
      await sleep(40000)

      await syncAccounts([account, accountOther])
      tokenBalanceAfter = await getTokenBalance(from)
      energyBalance = await getEnergyBalance(from)

      // 1152 from first withdraw + 127 from second one
      expect(energyBalance).bignumber.eq(denominator.mul(toBN(1279)))

      balanceDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
      // 2 from first + 1 from second
      expect(balanceDiff).bignumber.eq(denominator.mul(toBN(3)))
      expect(account.totalBalance()).eq('2')
      expect(accountOther.totalBalance()).eq('0')
    })
  })
})

mocha.run()
