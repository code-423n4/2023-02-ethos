const deploymentHelper = require("../utils/deploymentHelpers.js")
const { TestHelper: th, MoneyValues: mv } = require("../utils/testHelpers.js")
const { toBN, dec } = th

const TroveManagerTester = artifacts.require("./TroveManagerTester")
const LUSDToken = artifacts.require("./LUSDToken.sol")

contract('TroveManager - in Recovery Mode - back to normal mode in 1 tx', async accounts => {
  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  const [
    owner,
    alice, bob, carol, dennis, erin, freddy, greta, harry, ida,
    whale, defaulter_1, defaulter_2, defaulter_3, defaulter_4,
    A, B, C, D, E, F, G, H, I
  ] = accounts;

  let contracts
  let troveManager
  let stabilityPool
  let priceFeed
  let sortedTroves
  let collaterals

  let coll0MCR

  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployTestCollaterals(await deploymentHelper.deployLiquityCore())
    contracts.troveManager = await TroveManagerTester.new()
    contracts.lusdToken = await LUSDToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.governance.address,
      contracts.guardian.address
    )
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)

    troveManager = contracts.troveManager
    stabilityPool = contracts.stabilityPool
    priceFeed = contracts.priceFeedTestnet
    sortedTroves = contracts.sortedTroves
    collaterals = contracts.collaterals

    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)

    coll0MCR = await contracts.collateralConfig.getCollateralMCR(collaterals[0].address)
  })

  context('Batch liquidations', () => {
    const setup = async () => {
      const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(296, 16)), extraParams: { from: alice } })
      const { collateral: B_coll, totalDebt: B_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(280, 16)), extraParams: { from: bob } })
      const { collateral: C_coll, totalDebt: C_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(150, 16)), extraParams: { from: carol } })

      const totalLiquidatedDebt = A_totalDebt.add(B_totalDebt).add(C_totalDebt)

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(340, 16)), extraLUSDAmount: totalLiquidatedDebt, extraParams: { from: whale } })
      await stabilityPool.provideToSP(totalLiquidatedDebt, { from: whale })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)
      const TCR = await th.getTCR(contracts, collaterals[0].address)

      // Check Recovery Mode is active
      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))

      // Check troves A, B are in range MCR < ICR < TCR, C is below 100%
      const ICR_A = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
      const ICR_B = await troveManager.getCurrentICR(bob, collaterals[0].address, price)
      const ICR_C = await troveManager.getCurrentICR(carol, collaterals[0].address, price)

      assert.isTrue(ICR_A.gt(coll0MCR) && ICR_A.lt(TCR))
      assert.isTrue(ICR_B.gt(coll0MCR) && ICR_B.lt(TCR))
      assert.isTrue(ICR_C.lt(mv._ICR100))

      return {
        A_coll, A_totalDebt,
        B_coll, B_totalDebt,
        C_coll, C_totalDebt,
        totalLiquidatedDebt,
        price,
      }
    }

    it('First trove only doesn’t get out of Recovery Mode', async () => {
      await setup()
      const tx = await troveManager.batchLiquidateTroves(collaterals[0].address, [alice])

      const TCR = await th.getTCR(contracts, collaterals[0].address)
      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))
    })

    it('Two troves over MCR are liquidated', async () => {
      await setup()
      const tx = await troveManager.batchLiquidateTroves(collaterals[0].address, [alice, bob, carol])

      const liquidationEvents = th.getAllEventsByName(tx, 'TroveLiquidated')
      assert.equal(liquidationEvents.length, 3, 'Not enough liquidations')

      // Confirm all troves removed
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, alice))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, bob))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, carol))

      // Confirm troves have status 'closed by liquidation' (Status enum element idx 3)
      assert.equal((await troveManager.Troves(alice, collaterals[0].address))[3], '3')
      assert.equal((await troveManager.Troves(bob, collaterals[0].address))[3], '3')
      assert.equal((await troveManager.Troves(carol, collaterals[0].address))[3], '3')
    })

    it('Stability Pool profit matches', async () => {
      const {
        A_coll, A_totalDebt,
        C_coll, C_totalDebt,
        totalLiquidatedDebt,
        price,
      } = await setup()

      const spEthBefore = await stabilityPool.getCollateral(collaterals[0].address)
      const spLusdBefore = await stabilityPool.getTotalLUSDDeposits()

      const tx = await troveManager.batchLiquidateTroves(collaterals[0].address, [alice, carol])

      // Confirm all troves removed
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, alice))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, carol))

      // Confirm troves have status 'closed by liquidation' (Status enum element idx 3)
      assert.equal((await troveManager.Troves(alice, collaterals[0].address))[3], '3')
      assert.equal((await troveManager.Troves(carol, collaterals[0].address))[3], '3')

      const spEthAfter = await stabilityPool.getCollateral(collaterals[0].address)
      const spLusdAfter = await stabilityPool.getTotalLUSDDeposits()

      // liquidate collaterals with the gas compensation fee subtracted
      let expectedCollateralLiquidatedA = th.applyLiquidationFee(A_totalDebt.mul(coll0MCR).div(price))
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      const bn_18 = toBN(18);
      if (collDecimals.lt(bn_18)) {
        expectedCollateralLiquidatedA = expectedCollateralLiquidatedA.div(toBN(10).pow(bn_18.sub(collDecimals)))
      } else if (collDecimals.gt(bn_18)) {
        expectedCollateralLiquidatedA = expectedCollateralLiquidatedA.mul(toBN(10).pow(collDecimals.sub(bn_18)))
      }
      const expectedCollateralLiquidatedC = th.applyLiquidationFee(C_coll)
      // Stability Pool gains
      const expectedGainInLUSD = expectedCollateralLiquidatedA.mul(price).div(mv._1e18BN).sub(A_totalDebt)
      const realGainInLUSD = spEthAfter.sub(spEthBefore).mul(price).div(mv._1e18BN).sub(spLusdBefore.sub(spLusdAfter))

      assert.equal(spEthAfter.sub(spEthBefore).toString(), expectedCollateralLiquidatedA.toString(), 'Stability Pool ETH doesn’t match')
      assert.equal(spLusdBefore.sub(spLusdAfter).toString(), A_totalDebt.toString(), 'Stability Pool LUSD doesn’t match')
      assert.equal(realGainInLUSD.toString(), expectedGainInLUSD.toString(), 'Stability Pool gains don’t match')
    })

    it('A trove over TCR is not liquidated', async () => {
      const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(280, 16)), extraParams: { from: alice } })
      const { collateral: B_coll, totalDebt: B_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(276, 16)), extraParams: { from: bob } })
      const { collateral: C_coll, totalDebt: C_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(150, 16)), extraParams: { from: carol } })

      const totalLiquidatedDebt = A_totalDebt.add(B_totalDebt).add(C_totalDebt)

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(310, 16)), extraLUSDAmount: totalLiquidatedDebt, extraParams: { from: whale } })
      await stabilityPool.provideToSP(totalLiquidatedDebt, { from: whale })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)
      const TCR = await th.getTCR(contracts, collaterals[0].address)

      // Check Recovery Mode is active
      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))

      // Check troves A, B are in range 110% < ICR < TCR, C is below 100%
      const ICR_A = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
      const ICR_B = await troveManager.getCurrentICR(bob, collaterals[0].address, price)
      const ICR_C = await troveManager.getCurrentICR(carol, collaterals[0].address, price)

      assert.isTrue(ICR_A.gt(TCR))
      assert.isTrue(ICR_B.gt(mv._MCR) && ICR_B.lt(TCR))
      assert.isTrue(ICR_C.lt(mv._ICR100))

      const tx = await troveManager.batchLiquidateTroves(collaterals[0].address, [bob, alice])

      const liquidationEvents = th.getAllEventsByName(tx, 'TroveLiquidated')
      assert.equal(liquidationEvents.length, 1, 'Not enough liquidations')

      // Confirm only Bob’s trove removed
      assert.isTrue(await sortedTroves.contains(collaterals[0].address, alice))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, bob))
      assert.isTrue(await sortedTroves.contains(collaterals[0].address, carol))

      // Confirm troves have status 'closed by liquidation' (Status enum element idx 3)
      assert.equal((await troveManager.Troves(bob, collaterals[0].address))[3], '3')
      // Confirm troves have status 'open' (Status enum element idx 1)
      assert.equal((await troveManager.Troves(alice, collaterals[0].address))[3], '1')
      assert.equal((await troveManager.Troves(carol, collaterals[0].address))[3], '1')
    })
  })

  context('Sequential liquidations', () => {
    const setup = async () => {
      const { collateral: A_coll, totalDebt: A_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(299, 16)), extraParams: { from: alice } })
      const { collateral: B_coll, totalDebt: B_totalDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(298, 16)), extraParams: { from: bob } })

      const totalLiquidatedDebt = A_totalDebt.add(B_totalDebt)

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(300, 16)), extraLUSDAmount: totalLiquidatedDebt, extraParams: { from: whale } })
      await stabilityPool.provideToSP(totalLiquidatedDebt, { from: whale })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)
      const TCR = await th.getTCR(contracts, collaterals[0].address)

      // Check Recovery Mode is active
      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))

      // Check troves A, B are in range 110% < ICR < TCR, C is below 100%
      const ICR_A = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
      const ICR_B = await troveManager.getCurrentICR(bob, collaterals[0].address, price)

      assert.isTrue(ICR_A.gt(mv._MCR) && ICR_A.lt(TCR))
      assert.isTrue(ICR_B.gt(mv._MCR) && ICR_B.lt(TCR))

      return {
        A_coll, A_totalDebt,
        B_coll, B_totalDebt,
        totalLiquidatedDebt,
        price,
      }
    }

    it('First trove only doesn’t get out of Recovery Mode', async () => {
      await setup()
      const tx = await troveManager.liquidateTroves(collaterals[0].address, 1)

      const TCR = await th.getTCR(contracts, collaterals[0].address)
      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))
    })

    it('Two troves over MCR are liquidated', async () => {
      await setup()
      const tx = await troveManager.liquidateTroves(collaterals[0].address, 10)

      const liquidationEvents = th.getAllEventsByName(tx, 'TroveLiquidated')
      assert.equal(liquidationEvents.length, 2, 'Not enough liquidations')

      // Confirm all troves removed
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, alice))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, bob))

      // Confirm troves have status 'closed by liquidation' (Status enum element idx 3)
      assert.equal((await troveManager.Troves(alice, collaterals[0].address))[3], '3')
      assert.equal((await troveManager.Troves(bob, collaterals[0].address))[3], '3')
    })
  })
})
