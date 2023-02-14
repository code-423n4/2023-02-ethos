const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const TroveManagerTester = artifacts.require("TroveManagerTester")
const LUSDToken = artifacts.require("LUSDToken")
const NonPayable = artifacts.require('NonPayable.sol')

const ZERO = toBN('0')
const maxBytes32 = th.maxBytes32

const GAS_PRICE = 10000000

contract('StabilityPool', async accounts => {

  const [owner,
    defaulter_1, defaulter_2, defaulter_3,
    whale,
    alice, bob, carol, dennis, erin, flyn,
    A, B, C, D, E, F,
  ] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let contracts
  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let oathToken
  let communityIssuance
  let collaterals

  let collDecimals

  let gasPriceInWei

  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const openTrove = async (params) => th.openTrove(contracts, params)
  const assertRevert = th.assertRevert

  describe("Stability Pool Mechanisms", async () => {

    before(async () => {
      gasPriceInWei = await web3.eth.getGasPrice()
    })

    //BEBIS transfer ownership of community issuance to the owner dummy account
    //mint to owner then fund, approve, to test funding and issuance, call fund() from owner
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
      const LQTYContracts = await deploymentHelper.deployLQTYContracts(multisig)

      priceFeed = contracts.priceFeedTestnet
      lusdToken = contracts.lusdToken
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      activePool = contracts.activePool
      stabilityPool = contracts.stabilityPool
      defaultPool = contracts.defaultPool
      borrowerOperations = contracts.borrowerOperations
      hintHelpers = contracts.hintHelpers
      collaterals = contracts.collaterals

      oathToken = LQTYContracts.oathToken
      communityIssuance = LQTYContracts.communityIssuance

      await deploymentHelper.connectLQTYContracts(LQTYContracts)
      await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)

      await oathToken.mint(owner, th.toBN(dec(14000, 18)));
      await oathToken.approve(communityIssuance.address, th.toBN(dec(14000, 18)), {from: owner});
      await communityIssuance.fund(th.toBN(dec(14000, 18)), {from: owner});

      collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    })

    // --- provideToSP() ---
    // increases recorded LUSD at Stability Pool
    it("provideToSP(): increases the Stability Pool LUSD balance", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---

      // provideToSP()
      await stabilityPool.provideToSP(200, { from: alice })

      // check LUSD balances after
      const stabilityPool_LUSD_After = await stabilityPool.getTotalLUSDDeposits()
      assert.equal(stabilityPool_LUSD_After, 200)
    })

    it("provideToSP(): updates the user's deposit record in StabilityPool", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---
      // check user's deposit record before
      const alice_depositRecord_Before = await stabilityPool.deposits(alice)
      assert.equal(alice_depositRecord_Before, 0)

      // provideToSP()
      await stabilityPool.provideToSP(200, { from: alice })

      // check user's deposit record after
      const alice_depositRecord_After = await stabilityPool.deposits(alice)
      assert.equal(alice_depositRecord_After, 200)
    })

    it("provideToSP(): reduces the user's LUSD balance by the correct amount", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(200), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      // --- TEST ---
      // get user's deposit record before
      const alice_LUSDBalance_Before = await lusdToken.balanceOf(alice)

      // provideToSP()
      await stabilityPool.provideToSP(200, { from: alice })

      // check user's LUSD balance change
      const alice_LUSDBalance_After = await lusdToken.balanceOf(alice)
      assert.equal(alice_LUSDBalance_Before.sub(alice_LUSDBalance_After), '200')
    })

    it("provideToSP(): increases totalLUSDDeposits by correct amount", async () => {
      // --- SETUP ---

      // Whale opens Trove with 50 ETH, adds 2000 LUSD to StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(2000, 18), { from: whale })

      const totalLUSDDeposits = await stabilityPool.getTotalLUSDDeposits()
      assert.equal(totalLUSDDeposits, dec(2000, 18))
    })

    it('provideToSP(): Correctly updates user snapshots of accumulated rewards per unit staked', async () => {
      // --- SETUP ---

      // Whale opens Trove and deposits to SP
      await openTrove({ collateral: collaterals[1], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      const whaleLUSD = await lusdToken.balanceOf(whale)
      await stabilityPool.provideToSP(whaleLUSD, { from: whale })

      // 2 Troves opened, each withdraws minimum debt
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, } })
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, } })

      // Alice makes Trove and withdraws 100 LUSD
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(5, 18)), extraParams: { from: alice } })


      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(collaterals[1].address, dec(105, 18));

      const SPLUSD_Before = await stabilityPool.getTotalLUSDDeposits()

      // Troves are closed
      await troveManager.liquidate(defaulter_1, collaterals[1].address, { from: owner })
      await troveManager.liquidate(defaulter_2, collaterals[1].address, { from: owner })
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_2))

      // Confirm SP has decreased
      const SPLUSD_After = await stabilityPool.getTotalLUSDDeposits()
      assert.isTrue(SPLUSD_After.lt(SPLUSD_Before))

      // --- TEST ---
      const P_Before = (await stabilityPool.P())
      const S_Before = (await stabilityPool.epochToScaleToSum(0, 0, collaterals[1].address))
      const G_Before = (await stabilityPool.epochToScaleToG(0, 0))
      assert.isTrue(P_Before.gt(toBN('0')))
      assert.isTrue(S_Before.gt(toBN('0')))

      // Check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_Before = (await stabilityPool.depositSnapshots_S(alice, collaterals[1].address)).toString()
      const alice_snapshot_P_Before = alice_snapshot_Before[0].toString()
      const alice_snapshot_G_Before = alice_snapshot_Before[1].toString()
      assert.equal(alice_snapshot_S_Before, '0')
      assert.equal(alice_snapshot_P_Before, '0')
      assert.equal(alice_snapshot_G_Before, '0')

      // Make deposit
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })

      // Check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_After = (await stabilityPool.depositSnapshots_S(alice, collaterals[1].address))
      const alice_snapshot_P_After = alice_snapshot_After[0]
      const alice_snapshot_G_After = alice_snapshot_After[1]

      assert.isTrue(alice_snapshot_S_After.eq(S_Before))
      assert.isTrue(alice_snapshot_P_After.eq(P_Before))
      assert.isTrue(alice_snapshot_G_After.gt(G_Before)); // G snapshot will increase since emissions are happening every second
    })

    it("provideToSP(), multiple deposits: updates user's deposit and snapshots", async () => {
      // --- SETUP ---
      // Whale opens Trove and deposits to SP
      await openTrove({ collateral: collaterals[0], value: toBN(dec(500, collDecimals)), extraLUSDAmount: toBN(dec(10000, 18)), extraParams: { from: whale } })
      const whaleLUSD = await lusdToken.balanceOf(whale)
      await stabilityPool.provideToSP(whaleLUSD, { from: whale })

      // 3 Troves opened.
      await openTrove({ collateral: collaterals[0], value: toBN(dec(1, collDecimals)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], value: toBN(dec(1, collDecimals)), extraParams: { from: defaulter_2 } })
      await openTrove({ collateral: collaterals[0], value: toBN(dec(1, collDecimals)), extraParams: { from: defaulter_3 } })

      // --- TEST ---

      // Alice makes deposit #1: 150 LUSD
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(850, 18)), ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(150, 18), { from: alice })

      const alice_Snapshot_0 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_0 = await stabilityPool.depositSnapshots_S(alice, collaterals[0].address)
      const alice_Snapshot_P_0 = alice_Snapshot_0[0]
      assert.equal(alice_Snapshot_S_0, 0)
      assert.equal(alice_Snapshot_P_0, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18));

      // 2 users with Trove with 180 LUSD drawn are closed
      await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })  // 180 LUSD closed
      await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner }) // 180 LUSD closed

      const alice_compoundedDeposit_1 = await stabilityPool.getCompoundedLUSDDeposit(alice)

      // Alice makes deposit #2
      const alice_topUp_1 = toBN(dec(100, 18))
      await stabilityPool.provideToSP(alice_topUp_1, { from: alice })

      const alice_newDeposit_1 = (await stabilityPool.deposits(alice)).toString()
      assert.equal(alice_compoundedDeposit_1.add(alice_topUp_1), alice_newDeposit_1)

      // get system reward terms
      const P_1 = await stabilityPool.P()
      const S_1 = await stabilityPool.epochToScaleToSum(0, 0, collaterals[0].address)
      assert.isTrue(P_1.lt(toBN(dec(1, 18))))
      assert.isTrue(S_1.gt(toBN('0')))

      // check Alice's new snapshot is correct
      const alice_Snapshot_1 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_1 = await stabilityPool.depositSnapshots_S(alice, collaterals[0].address)
      const alice_Snapshot_P_1 = alice_Snapshot_1[0]
      assert.isTrue(alice_Snapshot_S_1.eq(S_1))
      assert.isTrue(alice_Snapshot_P_1.eq(P_1))

      // Bob withdraws LUSD and deposits to StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await stabilityPool.provideToSP(dec(427, 18), { from: alice })

      // Defaulter 3 Trove is closed
      await troveManager.liquidate(defaulter_3, collaterals[0].address, { from: owner })

      const alice_compoundedDeposit_2 = await stabilityPool.getCompoundedLUSDDeposit(alice)

      const P_2 = await stabilityPool.P()
      const S_2 = await stabilityPool.epochToScaleToSum(0, 0, collaterals[0].address)
      assert.isTrue(P_2.lt(P_1))
      assert.isTrue(S_2.gt(S_1))

      // Alice makes deposit #3:  100LUSD
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })

      // check Alice's new snapshot is correct
      const alice_Snapshot_2 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_2 = await stabilityPool.depositSnapshots_S(alice, collaterals[0].address)
      const alice_Snapshot_P_2 = alice_Snapshot_2[0]
      assert.isTrue(alice_Snapshot_S_2.eq(S_2))
      assert.isTrue(alice_Snapshot_P_2.eq(P_2))
    })

    it("provideToSP(): reverts if user tries to provide more than their LUSD balance", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      const aliceLUSDbal = await lusdToken.balanceOf(alice)
      const bobLUSDbal = await lusdToken.balanceOf(bob)

      // Alice, attempts to deposit 1 wei more than her balance

      const aliceTxPromise = stabilityPool.provideToSP(aliceLUSDbal.add(toBN(1)), { from: alice })
      await assertRevert(aliceTxPromise, "revert")

      // Bob, attempts to deposit 235534 more than his balance

      const bobTxPromise = stabilityPool.provideToSP(bobLUSDbal.add(toBN(dec(235534, 18))), { from: bob })
      await assertRevert(bobTxPromise, "revert")
    })

    it("provideToSP(): reverts if user tries to provide 2^256-1 LUSD, which exceeds their balance", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

      const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

      // Alice attempts to deposit 2^256-1 LUSD
      try {
        aliceTx = await stabilityPool.provideToSP(maxBytes32, { from: alice })
        assert.isFalse(tx.receipt.status)
      } catch (error) {
        assert.include(error.message, "revert")
      }
    })

    it("provideToSP(): doesn't impact other users' deposits or collateral gains", async () => {
      await openTrove({ collateral: collaterals[0], value: toBN(dec(500, collDecimals)), extraLUSDAmount: toBN(dec(10000, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

      // D opens a trove
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Would-be defaulters open troves
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(collaterals[1].address, dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1, collaterals[1].address)
      await troveManager.liquidate(defaulter_2, collaterals[1].address)
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_2))

      const alice_LUSDDeposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(alice)).toString()
      const bob_LUSDDeposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()
      const carol_LUSDDeposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(carol)).toString()

      const alice_BTCGain_Before = (await stabilityPool.getDepositorCollateralGain(alice))[1][1].toString() // [[assets], [amounts]]
      const bob_BTCGain_Before = (await stabilityPool.getDepositorCollateralGain(bob))[1][1].toString() // [[assets], [amounts]]
      const carol_BTCGain_Before = (await stabilityPool.getDepositorCollateralGain(carol))[1][1].toString() // [[assets], [amounts]]

      //check non-zero LUSD and collateral gain in the Stability Pool
      const LUSDinSP = await stabilityPool.getTotalLUSDDeposits()
      const BTCinSP = await stabilityPool.getCollateral(collaterals[1].address)
      assert.isTrue(LUSDinSP.gt(mv._zeroBN))
      assert.isTrue(BTCinSP.gt(mv._zeroBN))

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPool.getCompoundedLUSDDeposit(dennis)).toString(), dec(1000, 18))

      const alice_LUSDDeposit_After = (await stabilityPool.getCompoundedLUSDDeposit(alice)).toString()
      const bob_LUSDDeposit_After = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()
      const carol_LUSDDeposit_After = (await stabilityPool.getCompoundedLUSDDeposit(carol)).toString()

      const alice_BTCGain_After = (await stabilityPool.getDepositorCollateralGain(alice))[1][1].toString() // [[assets], [amounts]]
      const bob_BTCGain_After = (await stabilityPool.getDepositorCollateralGain(bob))[1][1].toString() // [[assets], [amounts]]
      const carol_BTCGain_After = (await stabilityPool.getDepositorCollateralGain(carol))[1][1].toString() // [[assets], [amounts]]

      // Check compounded deposits and ETH gains for A, B and C have not changed
      assert.equal(alice_LUSDDeposit_Before, alice_LUSDDeposit_After)
      assert.equal(bob_LUSDDeposit_Before, bob_LUSDDeposit_After)
      assert.equal(carol_LUSDDeposit_Before, carol_LUSDDeposit_After)

      assert.equal(alice_BTCGain_Before, alice_BTCGain_After)
      assert.equal(bob_BTCGain_Before, bob_BTCGain_After)
      assert.equal(carol_BTCGain_Before, carol_BTCGain_After)
    })

    it("provideToSP(): doesn't impact system debt, collateral or TCR", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

      // D opens a trove
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Would-be defaulters open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      await troveManager.liquidate(defaulter_2, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_2))

      const activeDebt_Before = (await activePool.getLUSDDebt(collaterals[0].address)).toString()
      const defaultedDebt_Before = (await defaultPool.getLUSDDebt(collaterals[0].address)).toString()
      const activeColl_Before = (await activePool.getCollateral(collaterals[0].address)).toString()
      const defaultedColl_Before = (await defaultPool.getCollateral(collaterals[0].address)).toString()
      const TCR_Before = (await th.getTCR(contracts, collaterals[0].address)).toString()

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPool.getCompoundedLUSDDeposit(dennis)).toString(), dec(1000, 18))

      const activeDebt_After = (await activePool.getLUSDDebt(collaterals[0].address)).toString()
      const defaultedDebt_After = (await defaultPool.getLUSDDebt(collaterals[0].address)).toString()
      const activeColl_After = (await activePool.getCollateral(collaterals[0].address)).toString()
      const defaultedColl_After = (await defaultPool.getCollateral(collaterals[0].address)).toString()
      const TCR_After = (await th.getTCR(contracts, collaterals[0].address)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)
    })

    it("provideToSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), { from: bob })

      // D opens a trove
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManager.Troves(whale, collaterals[0].address))[0].toString()
      const alice_Debt_Before = (await troveManager.Troves(alice, collaterals[0].address))[0].toString()
      const bob_Debt_Before = (await troveManager.Troves(bob, collaterals[0].address))[0].toString()
      const carol_Debt_Before = (await troveManager.Troves(carol, collaterals[0].address))[0].toString()
      const dennis_Debt_Before = (await troveManager.Troves(dennis, collaterals[0].address))[0].toString()

      const whale_Coll_Before = (await troveManager.Troves(whale, collaterals[0].address))[1].toString()
      const alice_Coll_Before = (await troveManager.Troves(alice, collaterals[0].address))[1].toString()
      const bob_Coll_Before = (await troveManager.Troves(bob, collaterals[0].address))[1].toString()
      const carol_Coll_Before = (await troveManager.Troves(carol, collaterals[0].address))[1].toString()
      const dennis_Coll_Before = (await troveManager.Troves(dennis, collaterals[0].address))[1].toString()

      const whale_ICR_Before = (await troveManager.getCurrentICR(whale, collaterals[0].address, price)).toString()
      const alice_ICR_Before = (await troveManager.getCurrentICR(alice, collaterals[0].address, price)).toString()
      const bob_ICR_Before = (await troveManager.getCurrentICR(bob, collaterals[0].address, price)).toString()
      const carol_ICR_Before = (await troveManager.getCurrentICR(carol, collaterals[0].address, price)).toString()
      const dennis_ICR_Before = (await troveManager.getCurrentICR(dennis, collaterals[0].address, price)).toString()

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPool.getCompoundedLUSDDeposit(dennis)).toString(), dec(1000, 18))

      const whale_Debt_After = (await troveManager.Troves(whale, collaterals[0].address))[0].toString()
      const alice_Debt_After = (await troveManager.Troves(alice, collaterals[0].address))[0].toString()
      const bob_Debt_After = (await troveManager.Troves(bob, collaterals[0].address))[0].toString()
      const carol_Debt_After = (await troveManager.Troves(carol, collaterals[0].address))[0].toString()
      const dennis_Debt_After = (await troveManager.Troves(dennis, collaterals[0].address))[0].toString()

      const whale_Coll_After = (await troveManager.Troves(whale, collaterals[0].address))[1].toString()
      const alice_Coll_After = (await troveManager.Troves(alice, collaterals[0].address))[1].toString()
      const bob_Coll_After = (await troveManager.Troves(bob, collaterals[0].address))[1].toString()
      const carol_Coll_After = (await troveManager.Troves(carol, collaterals[0].address))[1].toString()
      const dennis_Coll_After = (await troveManager.Troves(dennis, collaterals[0].address))[1].toString()

      const whale_ICR_After = (await troveManager.getCurrentICR(whale, collaterals[0].address, price)).toString()
      const alice_ICR_After = (await troveManager.getCurrentICR(alice, collaterals[0].address, price)).toString()
      const bob_ICR_After = (await troveManager.getCurrentICR(bob, collaterals[0].address, price)).toString()
      const carol_ICR_After = (await troveManager.getCurrentICR(carol, collaterals[0].address, price)).toString()
      const dennis_ICR_After = (await troveManager.getCurrentICR(dennis, collaterals[0].address, price)).toString()

      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)
      assert.equal(dennis_Debt_Before, dennis_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)
      assert.equal(dennis_Coll_Before, dennis_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)
      assert.equal(dennis_ICR_Before, dennis_ICR_After)
    })

    it("provideToSP(): doesn't protect the depositor's trove from liquidation", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B provide 100 LUSD to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(1000, 18), { from: bob })

      // Confirm Bob has an active trove in the system
      assert.isTrue(await sortedTroves.contains(collaterals[0].address, bob))
      assert.equal((await troveManager.getTroveStatus(bob, collaterals[0].address)).toString(), '1')  // Confirm Bob's trove status is active

      // Confirm Bob has a Stability deposit
      assert.equal((await stabilityPool.getCompoundedLUSDDeposit(bob)).toString(), dec(1000, 18))

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)

      // Liquidate bob
      await troveManager.liquidate(bob, collaterals[0].address)

      // Check Bob's trove has been removed from the system
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, bob))
      assert.equal((await troveManager.getTroveStatus(bob, collaterals[0].address)).toString(), '3')  // check Bob's trove status was closed by liquidation
    })

    it("provideToSP(): providing 0 LUSD reverts", async () => {
      // --- SETUP ---
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B, C provides 100, 50, 30 LUSD to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), { from: carol })

      const bob_Deposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()
      const LUSDinSP_Before = (await stabilityPool.getTotalLUSDDeposits()).toString()

      assert.equal(LUSDinSP_Before, dec(180, 18))

      // Bob provides 0 LUSD to the Stability Pool 
      const txPromise_B = stabilityPool.provideToSP(0, { from: bob })
      await th.assertRevert(txPromise_B)
    })

    // --- OATH functionality ---
    it("provideToSP(), new deposit: when SP > 0, triggers OATH reward event - increases the sum G", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })

      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: B })

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Expect G has increased from the OATH reward event triggered
      assert.isTrue(G_After.gt(G_Before))
    })

    it("provideToSP(), new deposit: when SP is empty, doesn't update G", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws
      await stabilityPool.withdrawFromSP(dec(1000, 18), { from: A })

      // Check SP is empty
      assert.equal((await stabilityPool.getTotalLUSDDeposits()), '0')

      // Check G is non-zero
      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      assert.isTrue(G_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: B })

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Expect G has not changed
      assert.isTrue(G_After.eq(G_Before))
    })

    it("provideToSP(), new deposit: depositor does not receive any OATH rewards", async () => {
      await openTrove({ collateral: collaterals[0], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

      // A, B, open troves 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // Get A, B, C OATH balances before and confirm they're zero
      const A_OATHBalance_Before = await oathToken.balanceOf(A)
      const B_OATHBalance_Before = await oathToken.balanceOf(B)

      assert.equal(A_OATHBalance_Before, '0')
      assert.equal(B_OATHBalance_Before, '0')

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), { from: B })

      // Get A, B, C OATH balances after, and confirm they're still zero
      const A_OATHBalance_After = await oathToken.balanceOf(A)
      const B_OATHBalance_After = await oathToken.balanceOf(B)

      assert.equal(A_OATHBalance_After, '0')
      assert.equal(B_OATHBalance_After, '0')
    })

    it("provideToSP(), new deposit after past full withdrawal: depositor does not receive any OATH rewards", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C, open troves 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP --- 

      const initialDeposit_A = await lusdToken.balanceOf(A)
      const initialDeposit_B = await lusdToken.balanceOf(B)
      // A, B provide to SP
      await stabilityPool.provideToSP(initialDeposit_A, { from: A })
      await stabilityPool.provideToSP(initialDeposit_B, { from: B })

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // C deposits. A, and B earn OATH
      await stabilityPool.provideToSP(dec(5, 18), { from: C })

      // Price drops, defaulter is liquidated, A, B and C earn ETH
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts, collaterals[0].address))

      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      // price bounces back to 200 
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // A and B fully withdraw from the pool
      await stabilityPool.withdrawFromSP(initialDeposit_A, { from: A })
      await stabilityPool.withdrawFromSP(initialDeposit_B, { from: B })

      // --- TEST --- 

      // Get A, B, C OATH balances before and confirm they're non-zero
      const A_OATHBalance_Before = await oathToken.balanceOf(A)
      const B_OATHBalance_Before = await oathToken.balanceOf(B)
      assert.isTrue(A_OATHBalance_Before.gt(toBN('0')))
      assert.isTrue(B_OATHBalance_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: A })
      await stabilityPool.provideToSP(dec(200, 18), { from: B })

      // Get A, B, C OATH balances after, and confirm they have not changed
      const A_OATHBalance_After = await oathToken.balanceOf(A)
      const B_OATHBalance_After = await oathToken.balanceOf(B)

      assert.isTrue(A_OATHBalance_After.eq(A_OATHBalance_Before))
      assert.isTrue(B_OATHBalance_After.eq(B_OATHBalance_Before))
    })

    it("provideToSP(), new deposit: depositor does not receive ETH gains", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers LUSD to A, B
      await lusdToken.transfer(A, dec(100, 18), { from: whale })
      await lusdToken.transfer(B, dec(200, 18), { from: whale })

      // C, D open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await collaterals[0].balanceOf(A)
      const B_ETHBalance_Before = await collaterals[0].balanceOf(B)
      const C_ETHBalance_Before = await collaterals[0].balanceOf(C)
      const D_ETHBalance_Before = await collaterals[0].balanceOf(D)

      // A, B, C, D provide to SP
      const A_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(100, 18), { from: A, gasPrice: GAS_PRICE }))
      const B_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(200, 18), { from: B, gasPrice: GAS_PRICE }))
      const C_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(300, 18), { from: C, gasPrice: GAS_PRICE }))
      const D_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(400, 18), { from: D, gasPrice: GAS_PRICE }))

      // Get  ETH balances after
      const A_ETHBalance_After = await collaterals[0].balanceOf(A)
      const B_ETHBalance_After = await collaterals[0].balanceOf(B)
      const C_ETHBalance_After = await collaterals[0].balanceOf(C)
      const D_ETHBalance_After = await collaterals[0].balanceOf(D)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After.toString(), A_ETHBalance_Before.toString())
      assert.equal(B_ETHBalance_After.toString(), B_ETHBalance_Before.toString())
      assert.equal(C_ETHBalance_After.toString(), C_ETHBalance_Before.toString())
      assert.equal(D_ETHBalance_After.toString(), D_ETHBalance_Before.toString())
    })

    it("provideToSP(), new deposit after past full withdrawal: depositor does not receive ETH gains", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // Whale transfers LUSD to A, B
      await lusdToken.transfer(A, dec(1000, 18), { from: whale })
      await lusdToken.transfer(B, dec(1000, 18), { from: whale })

      // C, D open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(4000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(5000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- SETUP ---
      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(105, 18), { from: A })
      await stabilityPool.provideToSP(dec(105, 18), { from: B })
      await stabilityPool.provideToSP(dec(105, 18), { from: C })
      await stabilityPool.provideToSP(dec(105, 18), { from: D })

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B deposits. A,B,C,D earn OATH
      await stabilityPool.provideToSP(dec(5, 18), { from: B })

      // Price drops, defaulter is liquidated, A, B, C, D earn ETH
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts, collaterals[0].address))

      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      // Price bounces back
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // A B,C, D fully withdraw from the pool
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: D })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await collaterals[0].balanceOf(A)
      const B_ETHBalance_Before = await collaterals[0].balanceOf(B)
      const C_ETHBalance_Before = await collaterals[0].balanceOf(C)
      const D_ETHBalance_Before = await collaterals[0].balanceOf(D)

      // A, B, C, D provide to SP
      const A_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(100, 18), { from: A, gasPrice: GAS_PRICE, gasPrice: GAS_PRICE }))
      const B_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(200, 18), { from: B, gasPrice: GAS_PRICE, gasPrice: GAS_PRICE  }))
      const C_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(300, 18), { from: C, gasPrice: GAS_PRICE, gasPrice: GAS_PRICE  }))
      const D_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(400, 18), { from: D, gasPrice: GAS_PRICE, gasPrice: GAS_PRICE  }))

      // Get  ETH balances after
      const A_ETHBalance_After = await collaterals[0].balanceOf(A)
      const B_ETHBalance_After = await collaterals[0].balanceOf(B)
      const C_ETHBalance_After = await collaterals[0].balanceOf(C)
      const D_ETHBalance_After = await collaterals[0].balanceOf(D)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After.toString(), A_ETHBalance_Before.toString())
      assert.equal(B_ETHBalance_After.toString(), B_ETHBalance_Before.toString())
      assert.equal(C_ETHBalance_After.toString(), C_ETHBalance_Before.toString())
      assert.equal(D_ETHBalance_After.toString(), D_ETHBalance_Before.toString())
    })

    it("provideToSP(), topup: triggers OATH reward event - increases the sum G", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(3000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C provide to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: A })
      await stabilityPool.provideToSP(dec(50, 18), { from: B })
      await stabilityPool.provideToSP(dec(50, 18), { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B tops up
      await stabilityPool.provideToSP(dec(100, 18), { from: B })

      const G_After = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the OATH reward event triggered by B's topup
      assert.isTrue(G_After.gt(G_Before))
    })

    it("provideToSP(), topup: depositor receives OATH rewards", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get A, B, C OATH balance before
      const A_OATHBalance_Before = await oathToken.balanceOf(A)
      const B_OATHBalance_Before = await oathToken.balanceOf(B)
      const C_OATHBalance_Before = await oathToken.balanceOf(C)

      // A, B, C top up
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      // Get OATH balance after
      const A_OATHBalance_After = await oathToken.balanceOf(A)
      const B_OATHBalance_After = await oathToken.balanceOf(B)
      const C_OATHBalance_After = await oathToken.balanceOf(C)

      // Check OATH Balance of A, B, C has increased
      assert.isTrue(A_OATHBalance_After.gt(A_OATHBalance_Before))
      assert.isTrue(B_OATHBalance_After.gt(B_OATHBalance_Before))
      assert.isTrue(C_OATHBalance_After.gt(C_OATHBalance_Before))
    })

    it("provideToSP(): reverts when amount is zero", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(2000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })

      // Whale transfers LUSD to C, D
      await lusdToken.transfer(C, dec(100, 18), { from: whale })
      await lusdToken.transfer(D, dec(100, 18), { from: whale })

      txPromise_A = stabilityPool.provideToSP(0, { from: A })
      txPromise_B = stabilityPool.provideToSP(0, { from: B })
      txPromise_C = stabilityPool.provideToSP(0, { from: C })
      txPromise_D = stabilityPool.provideToSP(0, { from: D })

      await th.assertRevert(txPromise_A, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_B, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_C, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_D, 'StabilityPool: Amount must be non-zero')
    })

    it("provideToSP(): allowed even when minting paused", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // pause minting
      await contracts.guardian.execute(lusdToken.address, 0, th.getTransactionData('pauseMinting()', []), 0, 100_000);

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })
    });

    it("provideToSP(): cannot deposit into older version of protocol", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      const newContracts = await deploymentHelper.deployLiquityCore();
      newContracts.troveManager = await TroveManagerTester.new()
      newContracts.lusdToken = lusdToken;
      newContracts.treasury = contracts.treasury;
      newContracts.collaterals = contracts.collaterals;
      newContracts.erc4626vaults = contracts.erc4626vaults;
      const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)
      await deploymentHelper.connectLQTYContracts(LQTYContracts);
      await deploymentHelper.connectCoreContracts(newContracts, LQTYContracts)
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, newContracts)
      await contracts.governance.execute(
        lusdToken.address,
        0,
        th.getTransactionData(
          'upgradeProtocol(address,address,address)',
          [
            newContracts.troveManager.address,
            newContracts.stabilityPool.address,
            newContracts.borrowerOperations.address
          ]
        ),
        0,
        300_000
      );

      // Old stability pool reverts, but new one accepts deposit
      th.assertRevert(
        stabilityPool.provideToSP(dec(10, 18), { from: A }),
        "LUSD: Caller is not StabilityPool"
      );

      await newContracts.stabilityPool.provideToSP(dec(10, 18), { from: A })
    });

    it("allows liquidations even when minting paused", async () => {
      // Whale opens Trove and deposits to SP
      await openTrove({ collateral: collaterals[1], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      const whaleLUSD = await lusdToken.balanceOf(whale)
      await stabilityPool.provideToSP(whaleLUSD, { from: whale })

      // 2 Troves opened, each withdraws minimum debt
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, } })
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, } })

      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(collaterals[1].address, dec(105, 18));

      // pause minting
      await contracts.guardian.execute(lusdToken.address, 0, th.getTransactionData('pauseMinting()', []), 0, 100_000);

      // Troves are closed
      await troveManager.liquidate(defaulter_1, collaterals[1].address, { from: owner })
      await troveManager.liquidate(defaulter_2, collaterals[1].address, { from: owner })
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_2))
    });

    it("older versions of the protocol can still liquidate", async () => {
      // Whale opens Trove and deposits to SP
      await openTrove({ collateral: collaterals[1], value: dec(50, collDecimals), extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      const whaleLUSD = await lusdToken.balanceOf(whale)
      await stabilityPool.provideToSP(whaleLUSD, { from: whale })

      // 2 Troves opened, each withdraws minimum debt
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1, } })
      await openTrove({ collateral: collaterals[1], extraLUSDAmount: 0, ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2, } })

      const newContracts = await deploymentHelper.deployLiquityCore();
      newContracts.troveManager = await TroveManagerTester.new()
      newContracts.lusdToken = lusdToken;
      newContracts.treasury = contracts.treasury;
      newContracts.collaterals = contracts.collaterals;
      newContracts.erc4626vaults = contracts.erc4626vaults;
      const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)
      await deploymentHelper.connectLQTYContracts(LQTYContracts);
      await deploymentHelper.connectCoreContracts(newContracts, LQTYContracts)
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, newContracts)
      await contracts.governance.execute(
        lusdToken.address,
        0,
        th.getTransactionData(
          'upgradeProtocol(address,address,address)',
          [
            newContracts.troveManager.address,
            newContracts.stabilityPool.address,
            newContracts.borrowerOperations.address
          ]
        ),
        0,
        300_000
      );

      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(collaterals[1].address, dec(105, 18));

      // Troves are closed
      await troveManager.liquidate(defaulter_1, collaterals[1].address, { from: owner })
      await troveManager.liquidate(defaulter_2, collaterals[1].address, { from: owner })
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[1].address, defaulter_2))
    });

    // --- withdrawFromSP ---

    it("withdrawFromSP(): reverts when user has no active deposit", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })

      await stabilityPool.provideToSP(dec(100, 18), { from: alice })

      const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
      const bob_initialDeposit = (await stabilityPool.deposits(bob)).toString()

      assert.equal(alice_initialDeposit, dec(100, 18))
      assert.equal(bob_initialDeposit, '0')

      const txAlice = await stabilityPool.withdrawFromSP(dec(100, 18), { from: alice })
      assert.isTrue(txAlice.receipt.status)


      try {
        const txBob = await stabilityPool.withdrawFromSP(dec(100, 18), { from: bob })
        assert.isFalse(txBob.receipt.status)
      } catch (err) {
        assert.include(err.message, "revert")
        // TODO: infamous issue #99
        //assert.include(err.message, "User must have a non-zero deposit")

      }
    })

    it("withdrawFromSP(): reverts when amount > 0 and system has an undercollateralized trove", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })

      await stabilityPool.provideToSP(dec(100, 18), { from: alice })

      const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
      assert.equal(alice_initialDeposit, dec(100, 18))

      // defaulter opens trove
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // ETH drops, defaulter is in liquidation range (but not liquidated yet)
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))

      await th.assertRevert(stabilityPool.withdrawFromSP(dec(100, 18), { from: alice }))
    })

    it("withdrawFromSP(): partial retrieval - retrieves correct LUSD amount and the entire ETH Gain, and updates deposit", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      // 2 Troves opened
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18));

      // 2 users with Trove with 170 LUSD drawn are closed
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })  // 170 LUSD closed
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner }) // 170 LUSD closed

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice LUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedLUSDLoss_A = (liquidatedDebt_1.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedLUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedLUSDLoss_A)
      const compoundedLUSDDeposit_A = await stabilityPool.getCompoundedLUSDDeposit(alice)

      assert.isAtMost(th.getDifference(expectedCompoundedLUSDDeposit_A, compoundedLUSDDeposit_A), 100000)

      // Alice retrieves part of her entitled LUSD: 9000 LUSD
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

      const expectedNewDeposit_A = (compoundedLUSDDeposit_A.sub(toBN(dec(9000, 18))))

      // check Alice's deposit has been updated to equal her compounded deposit minus her withdrawal */
      const newDeposit = (await stabilityPool.deposits(alice)).toString()
      assert.isAtMost(th.getDifference(newDeposit, expectedNewDeposit_A), 100000)

      // Expect Alice has withdrawn all ETH gain
      const alice_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0] // [[assets], [amounts]]
      assert.equal(alice_pendingETHGain, 0)
    })

    it("withdrawFromSP(): partial retrieval - leaves the correct amount of LUSD in the Stability Pool", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      // 2 Troves opened
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      const SP_LUSD_Before = await stabilityPool.getTotalLUSDDeposits()
      assert.equal(SP_LUSD_Before, dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18));

      // 2 users liquidated
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner })

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice retrieves part of her entitled LUSD: 9000 LUSD
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

      /* Check SP has reduced from 2 liquidations and Alice's withdrawal
      Expect LUSD in SP = (200000 - liquidatedDebt_1 - liquidatedDebt_2 - 9000) */
      const expectedSPLUSD = toBN(dec(200000, 18))
        .sub(toBN(liquidatedDebt_1))
        .sub(toBN(liquidatedDebt_2))
        .sub(toBN(dec(9000, 18)))

      const SP_LUSD_After = (await stabilityPool.getTotalLUSDDeposits()).toString()

      th.assertIsApproximatelyEqual(SP_LUSD_After, expectedSPLUSD)
    })

    it("withdrawFromSP(): full retrieval - leaves the correct amount of LUSD in the Stability Pool", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      // 2 Troves opened
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      const SP_LUSD_Before = await stabilityPool.getTotalLUSDDeposits()
      assert.equal(SP_LUSD_Before, dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18));

      // 2 defaulters liquidated
      const liquidationTX_1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })
      const liquidationTX_2 = await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner })

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      // Alice LUSDLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedLUSDLoss_A = (liquidatedDebt_1.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedLUSDDeposit_A = toBN(dec(15000, 18)).sub(expectedLUSDLoss_A)
      const compoundedLUSDDeposit_A = await stabilityPool.getCompoundedLUSDDeposit(alice)

      assert.isAtMost(th.getDifference(expectedCompoundedLUSDDeposit_A, compoundedLUSDDeposit_A), 100000)

      const LUSDinSPBefore = await stabilityPool.getTotalLUSDDeposits()

      // Alice retrieves all of her entitled LUSD:
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

      const expectedLUSDinSPAfter = LUSDinSPBefore.sub(compoundedLUSDDeposit_A)

      const LUSDinSPAfter = await stabilityPool.getTotalLUSDDeposits()
      assert.isAtMost(th.getDifference(expectedLUSDinSPAfter, LUSDinSPAfter), 100000)
    })

    it("withdrawFromSP(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero ETH", async () => {
      // --- SETUP ---
      // Whale deposits 1850 LUSD in StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(18500, 18), { from: whale })

      // 2 defaulters open
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18));

      // defaulters liquidated
      await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })
      await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner })

      // Alice retrieves all of her entitled LUSD:
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })
      assert.equal((await stabilityPool.getDepositorCollateralGain(alice))[1].length, 0)

      // Alice makes second deposit
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      assert.equal((await stabilityPool.getDepositorCollateralGain(alice))[1][0], 0)

      const ETHinSP_Before = (await stabilityPool.getCollateral(collaterals[0].address)).toString()

      // Alice attempts second withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal((await stabilityPool.getDepositorCollateralGain(alice))[1].length, 0)

      // Check ETH in pool does not change
      const ETHinSP_1 = (await stabilityPool.getCollateral(collaterals[0].address)).toString()
      assert.equal(ETHinSP_Before, ETHinSP_1)

      // Third deposit
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      assert.equal((await stabilityPool.getDepositorCollateralGain(alice))[1][0], 0)
    })

    it("withdrawFromSP(): it correctly updates the user's LUSD and ETH snapshots of entitled reward per unit staked", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      // 2 defaulters open
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      // check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_Before = (await stabilityPool.depositSnapshots_S(alice, collaterals[0].address)).toString()
      const alice_snapshot_P_Before = alice_snapshot_Before[0].toString()
      assert.equal(alice_snapshot_S_Before, 0)
      assert.equal(alice_snapshot_P_Before, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18));

      // 2 defaulters liquidated
      await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })
      await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner });

      // Alice retrieves part of her entitled LUSD: 9000 LUSD
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })

      const P = (await stabilityPool.P()).toString()
      const S = (await stabilityPool.epochToScaleToSum(0, 0, collaterals[0].address)).toString()
      // check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_After = (await stabilityPool.depositSnapshots_S(alice, collaterals[0].address)).toString()
      const alice_snapshot_P_After = alice_snapshot_After[0].toString()
      assert.equal(alice_snapshot_S_After, S)
      assert.equal(alice_snapshot_P_After, P)
    })

    it("withdrawFromSP(): decreases StabilityPool ETH", async () => {
      // --- SETUP ---
      // Whale deposits 185000 LUSD in StabilityPool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      // 1 defaulter opens
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // --- TEST ---

      // Alice makes deposit #1: 15000 LUSD
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: alice } })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulter's Trove falls below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(collaterals[0].address, '100000000000000000000');

      // defaulter's Trove is closed.
      const liquidationTx_1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })  // 180 LUSD closed
      const [, liquidatedColl,] = th.getEmittedLiquidationValues(liquidationTx_1)

      //Get ActivePool and StabilityPool Ether before retrieval:
      const active_ETH_Before = await activePool.getCollateral(collaterals[0].address)
      const stability_ETH_Before = await stabilityPool.getCollateral(collaterals[0].address)

      // Expect alice to be entitled to 15000/200000 of the liquidated coll
      const aliceExpectedETHGain = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const aliceETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0]
      assert.isTrue(aliceExpectedETHGain.eq(aliceETHGain))

      // Alice retrieves all of her deposit
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })

      const active_ETH_After = await activePool.getCollateral(collaterals[0].address)
      const stability_ETH_After = await stabilityPool.getCollateral(collaterals[0].address)

      const active_ETH_Difference = (active_ETH_Before.sub(active_ETH_After))
      const stability_ETH_Difference = (stability_ETH_Before.sub(stability_ETH_After))

      assert.equal(active_ETH_Difference, '0')

      // Expect StabilityPool to have decreased by Alice's ETHGain
      assert.isAtMost(th.getDifference(stability_ETH_Difference, aliceETHGain), 10000)
    })

    it("withdrawFromSP(): All depositors are able to withdraw from the SP to their account", async () => {
      // Whale opens trove 
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // 1 defaulter open
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // All depositors attempt to withdraw
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: dennis })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: erin })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: flyn })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')

      const totalDeposits = (await stabilityPool.getTotalLUSDDeposits()).toString()

      assert.isAtMost(th.getDifference(totalDeposits, '0'), 100000)
    })

    it("withdrawFromSP(): increases depositor's LUSD token balance by the expected amount", async () => {
      // Whale opens trove 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // 1 defaulter opens trove
      await collaterals[0].mint(defaulter_1, dec(100, collDecimals))
      await collaterals[0].approveInternal(defaulter_1, borrowerOperations.address, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(10000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })

      const defaulterDebt = (await troveManager.getEntireDebtAndColl(defaulter_1, collaterals[0].address))[0]

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      const aliceBalBefore = await lusdToken.balanceOf(alice)
      const bobBalBefore = await lusdToken.balanceOf(bob)

      /* From an offset of 10000 LUSD, each depositor receives
      LUSDLoss = 1666.6666666666666666 LUSD

      and thus with a deposit of 10000 LUSD, each should withdraw 8333.3333333333333333 LUSD (in practice, slightly less due to rounding error)
      */

      // Price bounces back to $200 per ETH
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // Bob issues a further 5000 LUSD from his trove 
      await borrowerOperations.withdrawLUSD(collaterals[0].address, th._100pct, dec(5000, 18), bob, bob, { from: bob })

      // Expect Alice's LUSD balance increase be very close to 8333.3333333333333333 LUSD
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      const aliceBalance = (await lusdToken.balanceOf(alice))

      assert.isAtMost(th.getDifference(aliceBalance.sub(aliceBalBefore), '8333333333333333333333'), 100000)

      // expect Bob's LUSD balance increase to be very close to  13333.33333333333333333 LUSD
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
      const bobBalance = (await lusdToken.balanceOf(bob))
      assert.isAtMost(th.getDifference(bobBalance.sub(bobBalBefore), '13333333333333333333333'), 100000)
    })

    it("withdrawFromSP(): doesn't impact other users Stability deposits or ETH gains", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      // Would-be defaulters open troves
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      await troveManager.liquidate(defaulter_2, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_2))

      const alice_LUSDDeposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(alice)).toString()
      const bob_LUSDDeposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()

      const alice_ETHGain_Before = (await stabilityPool.getDepositorCollateralGain(alice))[1][0].toString()
      const bob_ETHGain_Before = (await stabilityPool.getDepositorCollateralGain(bob))[1][0].toString()

      //check non-zero LUSD and ETHGain in the Stability Pool
      const LUSDinSP = await stabilityPool.getTotalLUSDDeposits()
      const ETHinSP = await stabilityPool.getCollateral(collaterals[0].address)
      assert.isTrue(LUSDinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))

      // Price rises
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // Carol withdraws her Stability deposit 
      assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(carol)).toString(), '0')

      const alice_LUSDDeposit_After = (await stabilityPool.getCompoundedLUSDDeposit(alice)).toString()
      const bob_LUSDDeposit_After = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()

      const alice_ETHGain_After = (await stabilityPool.getDepositorCollateralGain(alice))[1][0].toString()
      const bob_ETHGain_After = (await stabilityPool.getDepositorCollateralGain(bob))[1][0].toString()

      // Check compounded deposits and ETH gains for A and B have not changed
      assert.equal(alice_LUSDDeposit_Before, alice_LUSDDeposit_After)
      assert.equal(bob_LUSDDeposit_Before, bob_LUSDDeposit_After)

      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)
    })

    it("withdrawFromSP(): doesn't impact system debt, collateral or TCR ", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      // Would-be defaulters open troves
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      await troveManager.liquidate(defaulter_2, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_2))

      // Price rises
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      const activeDebt_Before = (await activePool.getLUSDDebt(collaterals[0].address)).toString()
      const defaultedDebt_Before = (await defaultPool.getLUSDDebt(collaterals[0].address)).toString()
      const activeColl_Before = (await activePool.getCollateral(collaterals[0].address)).toString()
      const defaultedColl_Before = (await defaultPool.getCollateral(collaterals[0].address)).toString()
      const TCR_Before = (await th.getTCR(contracts, collaterals[0].address)).toString()

      // Carol withdraws her Stability deposit 
      assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(carol)).toString(), '0')

      const activeDebt_After = (await activePool.getLUSDDebt(collaterals[0].address)).toString()
      const defaultedDebt_After = (await defaultPool.getLUSDDebt(collaterals[0].address)).toString()
      const activeColl_After = (await activePool.getCollateral(collaterals[0].address)).toString()
      const defaultedColl_After = (await defaultPool.getCollateral(collaterals[0].address)).toString()
      const TCR_After = (await th.getTCR(contracts, collaterals[0].address)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)
    })

    it("withdrawFromSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B and C provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManager.Troves(whale, collaterals[0].address))[0].toString()
      const alice_Debt_Before = (await troveManager.Troves(alice, collaterals[0].address))[0].toString()
      const bob_Debt_Before = (await troveManager.Troves(bob, collaterals[0].address))[0].toString()
      const carol_Debt_Before = (await troveManager.Troves(carol, collaterals[0].address))[0].toString()

      const whale_Coll_Before = (await troveManager.Troves(whale, collaterals[0].address))[1].toString()
      const alice_Coll_Before = (await troveManager.Troves(alice, collaterals[0].address))[1].toString()
      const bob_Coll_Before = (await troveManager.Troves(bob, collaterals[0].address))[1].toString()
      const carol_Coll_Before = (await troveManager.Troves(carol, collaterals[0].address))[1].toString()

      const whale_ICR_Before = (await troveManager.getCurrentICR(whale, collaterals[0].address, price)).toString()
      const alice_ICR_Before = (await troveManager.getCurrentICR(alice, collaterals[0].address, price)).toString()
      const bob_ICR_Before = (await troveManager.getCurrentICR(bob, collaterals[0].address, price)).toString()
      const carol_ICR_Before = (await troveManager.getCurrentICR(carol, collaterals[0].address, price)).toString()

      // price rises
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // Carol withdraws her Stability deposit 
      assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(carol)).toString(), '0')

      const whale_Debt_After = (await troveManager.Troves(whale, collaterals[0].address))[0].toString()
      const alice_Debt_After = (await troveManager.Troves(alice, collaterals[0].address))[0].toString()
      const bob_Debt_After = (await troveManager.Troves(bob, collaterals[0].address))[0].toString()
      const carol_Debt_After = (await troveManager.Troves(carol, collaterals[0].address))[0].toString()

      const whale_Coll_After = (await troveManager.Troves(whale, collaterals[0].address))[1].toString()
      const alice_Coll_After = (await troveManager.Troves(alice, collaterals[0].address))[1].toString()
      const bob_Coll_After = (await troveManager.Troves(bob, collaterals[0].address))[1].toString()
      const carol_Coll_After = (await troveManager.Troves(carol, collaterals[0].address))[1].toString()

      const whale_ICR_After = (await troveManager.getCurrentICR(whale, collaterals[0].address, price)).toString()
      const alice_ICR_After = (await troveManager.getCurrentICR(alice, collaterals[0].address, price)).toString()
      const bob_ICR_After = (await troveManager.getCurrentICR(bob, collaterals[0].address, price)).toString()
      const carol_ICR_After = (await troveManager.getCurrentICR(carol, collaterals[0].address, price)).toString()

      // Check all troves are unaffected by Carol's Stability deposit withdrawal
      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)
    })

    it("withdrawFromSP(): succeeds when amount is 0 and system has an undercollateralized trove", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })

      await stabilityPool.provideToSP(dec(100, 18), { from: A })

      const A_initialDeposit = (await stabilityPool.deposits(A)).toString()
      assert.equal(A_initialDeposit, dec(100, 18))

      // defaulters opens trove
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      // ETH drops, defaulters are in liquidation range
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, collaterals[0].address, troveManager, price))

      await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

      // Liquidate d1
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))

      // Check d2 is undercollateralized
      assert.isTrue(await th.ICRbetween100and110(defaulter_2, collaterals[0].address, troveManager, price))
      assert.isTrue(await sortedTroves.contains(collaterals[0].address, defaulter_2))

      const A_ETHBalBefore = toBN(await collaterals[0].balanceOf(A))
      const A_LQTYBalBefore = await oathToken.balanceOf(A)

      // Check Alice has gains to withdraw
      const A_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(A))[1][0]
      const A_pendingLQTYGain = await stabilityPool.getDepositorLQTYGain(A)
      assert.isTrue(A_pendingETHGain.gt(toBN('0')))
      assert.isTrue(A_pendingLQTYGain.gt(toBN('0')))

      // Check withdrawal of 0 succeeds
      const tx = await stabilityPool.withdrawFromSP(0, { from: A, gasPrice: GAS_PRICE })
      assert.isTrue(tx.receipt.status)

      const A_ETHBalAfter = toBN(await collaterals[0].balanceOf(A))

      const A_LQTYBalAfter = await oathToken.balanceOf(A)
      const A_LQTYBalDiff = A_LQTYBalAfter.sub(A_LQTYBalBefore)

      // Check A's ETH and OATH balances have increased correctly
      assert.isTrue(A_ETHBalAfter.sub(A_ETHBalBefore).eq(A_pendingETHGain))
      assert.isAtMost(th.getDifference(A_LQTYBalDiff, A_pendingLQTYGain), 1000)
    })

    it("withdrawFromSP(): withdrawing 0 LUSD doesn't alter the caller's deposit or the total LUSD in the Stability Pool", async () => {
      // --- SETUP ---
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // A, B, C provides 100, 50, 30 LUSD to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), { from: carol })

      const bob_Deposit_Before = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()
      const LUSDinSP_Before = (await stabilityPool.getTotalLUSDDeposits()).toString()

      assert.equal(LUSDinSP_Before, dec(180, 18))

      // Bob withdraws 0 LUSD from the Stability Pool 
      await stabilityPool.withdrawFromSP(0, { from: bob })

      // check Bob's deposit and total LUSD in Stability Pool has not changed
      const bob_Deposit_After = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()
      const LUSDinSP_After = (await stabilityPool.getTotalLUSDDeposits()).toString()

      assert.equal(bob_Deposit_Before, bob_Deposit_After)
      assert.equal(LUSDinSP_Before, LUSDinSP_After)
    })

    it("withdrawFromSP(): withdrawing 0 ETH Gain does not alter the caller's ETH balance, their trove collateral, or the ETH  in the Stability Pool", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // Would-be defaulter open trove
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(110, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts, collaterals[0].address))

      // Defaulter 1 liquidated, full offset
      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      // Dennis opens trove and deposits to Stability Pool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: dennis } })
      await stabilityPool.provideToSP(dec(100, 18), { from: dennis })

      // Check Dennis has 0 ETHGain
      const dennis_ETHGain = (await stabilityPool.getDepositorCollateralGain(dennis))[1][0].toString()
      assert.equal(dennis_ETHGain, '0')

      const dennis_ETHBalance_Before = (await collaterals[0].balanceOf(dennis)).toString()
      const dennis_Collateral_Before = ((await troveManager.Troves(dennis, collaterals[0].address))[1]).toString()
      const ETHinSP_Before = (await stabilityPool.getCollateral(collaterals[0].address)).toString()

      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // Dennis withdraws his full deposit and ETHGain to his account
      await stabilityPool.withdrawFromSP(dec(100, 18), { from: dennis, gasPrice: GAS_PRICE  })

      // Check withdrawal does not alter Dennis' ETH balance or his trove's collateral
      const dennis_ETHBalance_After = (await collaterals[0].balanceOf(dennis)).toString()
      const dennis_Collateral_After = ((await troveManager.Troves(dennis, collaterals[0].address))[1]).toString()
      const ETHinSP_After = (await stabilityPool.getCollateral(collaterals[0].address)).toString()

      assert.equal(dennis_ETHBalance_Before, dennis_ETHBalance_After)
      assert.equal(dennis_Collateral_Before, dennis_Collateral_After)

      // Check withdrawal has not altered the ETH in the Stability Pool
      assert.equal(ETHinSP_Before, ETHinSP_After)
    })

    it("withdrawFromSP(): Request to withdraw > caller's deposit only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C provide LUSD to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      const alice_LUSD_Balance_Before = await lusdToken.balanceOf(alice)
      const bob_LUSD_Balance_Before = await lusdToken.balanceOf(bob)

      const alice_Deposit_Before = await stabilityPool.getCompoundedLUSDDeposit(alice)
      const bob_Deposit_Before = await stabilityPool.getCompoundedLUSDDeposit(bob)

      const LUSDinSP_Before = await stabilityPool.getTotalLUSDDeposits()

      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // Bob attempts to withdraws 1 wei more than his compounded deposit from the Stability Pool
      await stabilityPool.withdrawFromSP(bob_Deposit_Before.add(toBN(1)), { from: bob })

      // Check Bob's LUSD balance has risen by only the value of his compounded deposit
      const bob_expectedLUSDBalance = (bob_LUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const bob_LUSD_Balance_After = (await lusdToken.balanceOf(bob)).toString()
      assert.equal(bob_LUSD_Balance_After, bob_expectedLUSDBalance)

      // Alice attempts to withdraws 2309842309.000000000000000000 LUSD from the Stability Pool 
      await stabilityPool.withdrawFromSP('2309842309000000000000000000', { from: alice })

      // Check Alice's LUSD balance has risen by only the value of her compounded deposit
      const alice_expectedLUSDBalance = (alice_LUSD_Balance_Before.add(alice_Deposit_Before)).toString()
      const alice_LUSD_Balance_After = (await lusdToken.balanceOf(alice)).toString()
      assert.equal(alice_LUSD_Balance_After, alice_expectedLUSDBalance)

      // Check LUSD in Stability Pool has been reduced by only Alice's compounded deposit and Bob's compounded deposit
      const expectedLUSDinSP = (LUSDinSP_Before.sub(alice_Deposit_Before).sub(bob_Deposit_Before)).toString()
      const LUSDinSP_After = (await stabilityPool.getTotalLUSDDeposits()).toString()
      assert.equal(LUSDinSP_After, expectedLUSDinSP)
    })

    it("withdrawFromSP(): Request to withdraw 2^256-1 LUSD only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      // A, B, C open troves 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      // A, B, C provides 100, 50, 30 LUSD to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      const bob_LUSD_Balance_Before = await lusdToken.balanceOf(bob)

      const bob_Deposit_Before = await stabilityPool.getCompoundedLUSDDeposit(bob)

      const LUSDinSP_Before = await stabilityPool.getTotalLUSDDeposits()

      const maxBytes32 = web3.utils.toBN("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // Bob attempts to withdraws maxBytes32 LUSD from the Stability Pool
      await stabilityPool.withdrawFromSP(maxBytes32, { from: bob })

      // Check Bob's LUSD balance has risen by only the value of his compounded deposit
      const bob_expectedLUSDBalance = (bob_LUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const bob_LUSD_Balance_After = (await lusdToken.balanceOf(bob)).toString()
      assert.equal(bob_LUSD_Balance_After, bob_expectedLUSDBalance)

      // Check LUSD in Stability Pool has been reduced by only  Bob's compounded deposit
      const expectedLUSDinSP = (LUSDinSP_Before.sub(bob_Deposit_Before)).toString()
      const LUSDinSP_After = (await stabilityPool.getTotalLUSDDeposits()).toString()
      assert.equal(LUSDinSP_After, expectedLUSDinSP)
    })

    it("withdrawFromSP(): caller can withdraw full deposit and ETH gain during Recovery Mode", async () => {
      // --- SETUP ---

      // Price doubles
      await priceFeed.setPrice(collaterals[0].address, dec(400, 18))
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
      // Price halves
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(4, 18)), extraParams: { from: carol } })

      await collaterals[0].mint(defaulter_1, dec(100, collDecimals))
      await collaterals[0].approveInternal(defaulter_1, borrowerOperations.address, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(10000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })

      // A, B, C provides 10000, 5000, 3000 LUSD to SP
      const A_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(10000, 18), { from: alice, gasPrice: GAS_PRICE }))
      const B_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(5000, 18), { from: bob, gasPrice: GAS_PRICE }))
      const C_GAS_Used = th.gasUsed(await stabilityPool.provideToSP(dec(3000, 18), { from: carol, gasPrice: GAS_PRICE }))

      // Price drops
      await priceFeed.setPrice(collaterals[0].address, dec(110, 18))
      const price = await priceFeed.getPrice(collaterals[0].address)

      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))

      // Liquidate defaulter 1
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))

      const alice_LUSD_Balance_Before = await lusdToken.balanceOf(alice)
      const bob_LUSD_Balance_Before = await lusdToken.balanceOf(bob)
      const carol_LUSD_Balance_Before = await lusdToken.balanceOf(carol)

      const alice_ETH_Balance_Before = web3.utils.toBN(await collaterals[0].balanceOf(alice))
      const bob_ETH_Balance_Before = web3.utils.toBN(await collaterals[0].balanceOf(bob))
      const carol_ETH_Balance_Before = web3.utils.toBN(await collaterals[0].balanceOf(carol))

      const alice_Deposit_Before = await stabilityPool.getCompoundedLUSDDeposit(alice)
      const bob_Deposit_Before = await stabilityPool.getCompoundedLUSDDeposit(bob)
      const carol_Deposit_Before = await stabilityPool.getCompoundedLUSDDeposit(carol)

      const alice_ETHGain_Before = (await stabilityPool.getDepositorCollateralGain(alice))[1][0]
      const bob_ETHGain_Before = (await stabilityPool.getDepositorCollateralGain(bob))[1][0]
      const carol_ETHGain_Before = (await stabilityPool.getDepositorCollateralGain(carol))[1][0]

      const LUSDinSP_Before = await stabilityPool.getTotalLUSDDeposits()

      // Price rises
      await priceFeed.setPrice(collaterals[0].address, dec(240, 18))

      assert.isTrue(await th.checkRecoveryMode(contracts, collaterals[0].address))

      // A, B, C withdraw their full deposits from the Stability Pool
      const A_GAS_Deposit = th.gasUsed(await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice, gasPrice: GAS_PRICE  }))
      const B_GAS_Deposit = th.gasUsed(await stabilityPool.withdrawFromSP(dec(5000, 18), { from: bob, gasPrice: GAS_PRICE  }))
      const C_GAS_Deposit = th.gasUsed(await stabilityPool.withdrawFromSP(dec(3000, 18), { from: carol, gasPrice: GAS_PRICE  }))

      // Check LUSD balances of A, B, C have risen by the value of their compounded deposits, respectively
      const alice_expectedLUSDBalance = (alice_LUSD_Balance_Before.add(alice_Deposit_Before)).toString()

      const bob_expectedLUSDBalance = (bob_LUSD_Balance_Before.add(bob_Deposit_Before)).toString()
      const carol_expectedLUSDBalance = (carol_LUSD_Balance_Before.add(carol_Deposit_Before)).toString()

      const alice_LUSD_Balance_After = (await lusdToken.balanceOf(alice)).toString()
 
      const bob_LUSD_Balance_After = (await lusdToken.balanceOf(bob)).toString()
      const carol_LUSD_Balance_After = (await lusdToken.balanceOf(carol)).toString()



      assert.equal(alice_LUSD_Balance_After, alice_expectedLUSDBalance)
      assert.equal(bob_LUSD_Balance_After, bob_expectedLUSDBalance)
      assert.equal(carol_LUSD_Balance_After, carol_expectedLUSDBalance)

      // Check ETH balances of A, B, C have increased by the value of their ETH gain from liquidations, respectively
      const alice_expectedETHBalance = (alice_ETH_Balance_Before.add(alice_ETHGain_Before)).toString()
      const bob_expectedETHBalance = (bob_ETH_Balance_Before.add(bob_ETHGain_Before)).toString()
      const carol_expectedETHBalance = (carol_ETH_Balance_Before.add(carol_ETHGain_Before)).toString()

      const alice_ETHBalance_After = (await collaterals[0].balanceOf(alice)).toString()
      const bob_ETHBalance_After = (await collaterals[0].balanceOf(bob)).toString()
      const carol_ETHBalance_After = (await collaterals[0].balanceOf(carol)).toString()

      assert.equal(alice_expectedETHBalance, alice_ETHBalance_After)
      assert.equal(bob_expectedETHBalance, bob_ETHBalance_After)
      assert.equal(carol_expectedETHBalance, carol_ETHBalance_After)

      // Check LUSD in Stability Pool has been reduced by A, B and C's compounded deposit
      const expectedLUSDinSP = (LUSDinSP_Before
        .sub(alice_Deposit_Before)
        .sub(bob_Deposit_Before)
        .sub(carol_Deposit_Before))
        .toString()
      const LUSDinSP_After = (await stabilityPool.getTotalLUSDDeposits()).toString()
      assert.equal(LUSDinSP_After, expectedLUSDinSP)

      // Check ETH in SP has reduced to zero
      const ETHinSP_After = (await stabilityPool.getCollateral(collaterals[0].address)).toString()
      assert.isAtMost(th.getDifference(ETHinSP_After, '0'), 100000)
    })

    it("getDepositorCollateralGain(): depositor does not earn further ETH gains from liquidations while their compounded deposit == 0: ", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: alice } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: bob } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: carol } })

      // defaulters open troves 
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(15000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_3 } })

      // A, B, provide 10000, 5000 LUSD to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(5000, 18), { from: bob })

      //price drops
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))

      // Liquidate defaulter 1. Empties the Pool
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))

      const LUSDinSP = (await stabilityPool.getTotalLUSDDeposits()).toString()
      assert.equal(LUSDinSP, '0')

      // Check Stability deposits have been fully cancelled with debt, and are now all zero
      const alice_Deposit = (await stabilityPool.getCompoundedLUSDDeposit(alice)).toString()
      const bob_Deposit = (await stabilityPool.getCompoundedLUSDDeposit(bob)).toString()

      assert.equal(alice_Deposit, '0')
      assert.equal(bob_Deposit, '0')

      // Get ETH gain for A and B
      const alice_ETHGain_1 = (await stabilityPool.getDepositorCollateralGain(alice))[1][0].toString()
      const bob_ETHGain_1 = (await stabilityPool.getDepositorCollateralGain(bob))[1][0].toString()

      // Whale deposits 10000 LUSD to Stability Pool
      await stabilityPool.provideToSP(dec(1, 24), { from: whale })

      // Liquidation 2
      await troveManager.liquidate(defaulter_2, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_2))

      // Check Alice and Bob have not received ETH gain from liquidation 2 while their deposit was 0
      const alice_ETHGain_2 = (await stabilityPool.getDepositorCollateralGain(alice))[1][0].toString()
      const bob_ETHGain_2 = (await stabilityPool.getDepositorCollateralGain(bob))[1][0].toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_2)
      assert.equal(bob_ETHGain_1, bob_ETHGain_2)

      // Liquidation 3
      await troveManager.liquidate(defaulter_3, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_3))

      // Check Alice and Bob have not received ETH gain from liquidation 3 while their deposit was 0
      const alice_ETHGain_3 = (await stabilityPool.getDepositorCollateralGain(alice))[1][0].toString()
      const bob_ETHGain_3 = (await stabilityPool.getDepositorCollateralGain(bob))[1][0].toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_3)
      assert.equal(bob_ETHGain_1, bob_ETHGain_3)
    })

    // --- OATH functionality ---
    it("withdrawFromSP(): triggers OATH reward event - increases the sum G", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1, 24)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), { from: B })

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: A })

      const G_1 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the OATH reward event triggered
      assert.isTrue(G_1.gt(G_Before))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: B })

      const G_2 = await stabilityPool.epochToScaleToG(0, 0)

      // Expect G has increased from the OATH reward event triggered
      assert.isTrue(G_2.gt(G_1))
    })

    it("withdrawFromSP(), partial withdrawal: depositor receives OATH rewards", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get A, B, C OATH balance before
      const A_LQTYBalance_Before = await oathToken.balanceOf(A)
      const B_LQTYBalance_Before = await oathToken.balanceOf(B)
      const C_LQTYBalance_Before = await oathToken.balanceOf(C)

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      // Get OATH balance after
      const A_LQTYBalance_After = await oathToken.balanceOf(A)
      const B_LQTYBalance_After = await oathToken.balanceOf(B)
      const C_LQTYBalance_After = await oathToken.balanceOf(C)

      // Check OATH Balance of A, B, C has increased
      assert.isTrue(A_LQTYBalance_After.gt(A_LQTYBalance_Before))
      assert.isTrue(B_LQTYBalance_After.gt(B_LQTYBalance_Before))
      assert.isTrue(C_LQTYBalance_After.gt(C_LQTYBalance_Before))
    })

    it("withdrawFromSP(), full withdrawal: zero's depositor's snapshots", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1000000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      await openTrove({ collateral: collaterals[0],  ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to make G, S > 0 and P < 1  

      // E opens trove and makes a deposit
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: E } })
      await stabilityPool.provideToSP(dec(10000, 18), { from: E })

      // Fast-forward time and make a second deposit, to trigger OATH reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(10000, 18), { from: E })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts, collaterals[0].address))

      await troveManager.liquidate(defaulter_1, collaterals[0].address)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale, collaterals[0].address)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))

      // --- TEST ---

      // Whale transfers to A, B
      await lusdToken.transfer(A, dec(10000, 18), { from: whale })
      await lusdToken.transfer(B, dec(20000, 18), { from: whale })

      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // C, D open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(30000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: C } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(40000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: D } })

      // A, B, C, D make their initial deposits
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), { from: C })
      await stabilityPool.provideToSP(dec(40000, 18), { from: D })

      // Check deposits snapshots are non-zero

      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor)
        const snapshot_S = await stabilityPool.depositSnapshots_S(depositor, collaterals[0].address)

        const ZERO = toBN('0')
        // Check S,P, G snapshots are non-zero
        assert.isTrue(snapshot_S.eq(S_Before))  // S 
        assert.isTrue(snapshot[0].eq(P_Before))  // P 
        assert.isTrue(snapshot[1].gt(ZERO))  // GL increases a bit between each depositor op, so just check it is non-zero
        assert.equal(snapshot[2], '0')  // scale
        assert.equal(snapshot[3], '0')  // epoch
      }

      // All depositors make full withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

      // Check all depositors' snapshots have been zero'd
      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor)
        const snapshot_S = await stabilityPool.depositSnapshots_S(depositor, collaterals[0].address)

        // Check S, P, G snapshots are now zero
        assert.equal(snapshot_S, '0')  // S 
        assert.equal(snapshot[0], '0')  // P 
        assert.equal(snapshot[1], '0')  // G
        assert.equal(snapshot[2], '0')  // scale
        assert.equal(snapshot[3], '0')  // epoch
      }
    })

    it("withdrawFromSP(), reverts when initial deposit value is 0", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A opens trove and join the Stability Pool
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })

      await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      //  SETUP: Execute a series of operations to trigger OATH and ETH rewards for depositor A

      // Fast-forward time and make a second deposit, to trigger OATH reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(100, 18), { from: A })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(collaterals[0].address, dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts, collaterals[0].address))

      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))

      await priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      // A successfully withraws deposit and all gains
      await stabilityPool.withdrawFromSP(dec(10100, 18), { from: A })

      // Confirm A's recorded deposit is 0
      const A_deposit = await stabilityPool.deposits(A)
      assert.equal(A_deposit, '0')

      // --- TEST ---
      const expectedRevertMessage = "StabilityPool: User must have a non-zero deposit"

      // Further withdrawal attempt from A
      const withdrawalPromise_A = stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await th.assertRevert(withdrawalPromise_A, expectedRevertMessage)

      // Withdrawal attempt of a non-existent deposit, from C
      const withdrawalPromise_C = stabilityPool.withdrawFromSP(dec(10000, 18), { from: C })
      await th.assertRevert(withdrawalPromise_C, expectedRevertMessage)
    })

    it("withdrawFromSP(): allowed even when minting paused", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      // pause minting
      await contracts.guardian.execute(lusdToken.address, 0, th.getTransactionData('pauseMinting()', []), 0, 100_000);

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(10, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30, 18), { from: C })
    });

    it("withdrawFromSP(): can still withdraw from older version of protocol", async () => {
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })

      // A, B, C open troves
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(100, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(200, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
      await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(300, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      const newContracts = await deploymentHelper.deployLiquityCore();
      newContracts.troveManager = await TroveManagerTester.new()
      newContracts.lusdToken = lusdToken;
      newContracts.treasury = contracts.treasury;
      newContracts.collaterals = contracts.collaterals;
      newContracts.erc4626vaults = contracts.erc4626vaults;
      const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)
      await deploymentHelper.connectLQTYContracts(LQTYContracts);
      await deploymentHelper.connectCoreContracts(newContracts, LQTYContracts)
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, newContracts)
      await contracts.governance.execute(
        lusdToken.address,
        0,
        th.getTransactionData(
          'upgradeProtocol(address,address,address)',
          [
            newContracts.troveManager.address,
            newContracts.stabilityPool.address,
            newContracts.borrowerOperations.address
          ]
        ),
        0,
        300_000
      );

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(10, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30, 18), { from: C })
    });
  })
})

contract('Reset chain state', async accounts => { })
