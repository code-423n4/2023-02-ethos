const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const toBN = th.toBN
const getDifference = th.getDifference

const TroveManagerTester = artifacts.require("TroveManagerTester")
const LUSDToken = artifacts.require("LUSDToken")

const GAS_PRICE = 10000000

contract('StabilityPool - OATH Rewards', async accounts => {

  const [
    owner,
    whale,
    A, B, C, D, E, F, G, H,
    defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5, defaulter_6
  ] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let contracts

  let priceFeed
  let lusdToken
  let stabilityPool
  let sortedTroves
  let troveManager
  let borrowerOperations
  let oathToken
  let communityIssuanceTester
  let collaterals

  let communityLQTYSupply
  let issuance_M1
  let issuance_M2
  let issuance_M3
  let issuance_M4
  let issuance_M5
  let issuance_M6

  const ZERO_ADDRESS = th.ZERO_ADDRESS

  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const mintCollateralAndApproveBorrowerOps = async (collateral, user, amount) => {
    await collateral.mint(user, amount)
    await collateral.approveInternal(user, borrowerOperations.address, amount)
  }

  const openTrove = async (params) => th.openTrove(contracts, params)
  describe("OATH Rewards", async () => {

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
      const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(multisig)

      priceFeed = contracts.priceFeedTestnet
      lusdToken = contracts.lusdToken
      stabilityPool = contracts.stabilityPool
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      stabilityPool = contracts.stabilityPool
      borrowerOperations = contracts.borrowerOperations
      collaterals = contracts.collaterals

      oathToken = LQTYContracts.oathToken
      communityIssuanceTester = LQTYContracts.communityIssuance

      await deploymentHelper.connectLQTYContracts(LQTYContracts)
      await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)

      priceFeed.setPrice(collaterals[0].address, dec(200, 18))

      await oathToken.mint(owner, toBN(dec(14000, 18)));
      await oathToken.approve(communityIssuanceTester.address, toBN(dec(14000, 18)), {from: owner});
      await communityIssuanceTester.fund(toBN(dec(14000, 18)), {from: owner});
    })


    it("withdrawFromSP(): reward term G updates when OATH is issued", async () => {
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(1000, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), A, A, { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })

      const A_initialDeposit = (await stabilityPool.deposits(A)).toString()
      assert.equal(A_initialDeposit, dec(10000, 18))

      // defaulter opens trove
      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_1, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(9000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })

      // ETH drops
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Liquidate d1. Triggers issuance.
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))

      // Get G and communityIssuance before
      const G_Before = await stabilityPool.epochToScaleToG(0, 0)
      const OATHIssuedBefore = await communityIssuanceTester.totalOATHIssued()

      assert.isTrue(G_Before.gt(toBN(0)))
      assert.isTrue(OATHIssuedBefore.gt(toBN(0)))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      //  A withdraws some deposit. Triggers issuance.
      const tx = await stabilityPool.withdrawFromSP(1000, { from: A, gasPrice: GAS_PRICE })
      assert.isTrue(tx.receipt.status)

      // Check G and LQTYIssued increase slightly
      const G_After = await stabilityPool.epochToScaleToG(0, 0)
      const OATHIssuedAfter = await communityIssuanceTester.totalOATHIssued()

      assert.isTrue(G_After.gt(G_Before))
      assert.isTrue(OATHIssuedAfter.gt(OATHIssuedBefore))
    })

    // using the result of this to advance time by the desired amount from the deployment time, whether or not some extra time has passed in the meanwhile
    const getDuration = async (expectedDuration) => {
      const deploymentTime = (await lusdToken.getDeploymentStartTime()).toNumber()
      const currentTime = await th.getLatestBlockTimestamp(web3)
      const duration = Math.max(expectedDuration - (currentTime - deploymentTime), 0)

      return duration
    }

    // Simple case: 3 depositors, equal stake. No liquidations.
    it("withdrawFromSP(): Depositors with equal initial deposit withdraw correct OATH gain. No liquidations.", async () => {
      const initialIssuance = await communityIssuanceTester.totalOATHIssued()
      assert.equal(initialIssuance, 0)

      // Whale opens Trove with 10k ETH
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], whale, dec(10000, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(10000, collDecimals), th._100pct, dec(10000, 18), whale, whale, { from: whale })

      await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(100, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], B, dec(100, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], C, dec(100, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], D, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, dec(1, 22), A, A, { from: A })
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, dec(1, 22), B, B, { from: B })
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, dec(1, 22), C, C, { from: C })
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, dec(1, 22), D, D, { from: D })

      // Check all OATH balances are initially 0
      assert.equal(await oathToken.balanceOf(A), 0)
      assert.equal(await oathToken.balanceOf(B), 0)
      assert.equal(await oathToken.balanceOf(C), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(1, 22), { from: A })
      await stabilityPool.provideToSP(dec(1, 22), { from: B })
      await stabilityPool.provideToSP(dec(1, 22), { from: C })

      // One week passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_WEEK), web3.currentProvider)

      // D deposits, triggering OATH gains for A,B,C. Withdraws immediately after
      await stabilityPool.provideToSP(dec(1, 18), { from: D })
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

      // Expected gains for each depositor after 1 week (50% total issued).  Each deposit gets 1/3 of issuance.
      const expectedOATHGain_1wk = toBN(dec(14000, 18)).div(toBN('2')).div(toBN('3'))

      // Check OATH gain
      const A_LQTYGain_1wk = await stabilityPool.getDepositorLQTYGain(A)
      const B_LQTYGain_1wk = await stabilityPool.getDepositorLQTYGain(B)
      const C_LQTYGain_1wk = await stabilityPool.getDepositorLQTYGain(C)

      // Check gains are correct, error tolerance = 0.2 of a token

      assert.isAtMost(getDifference(A_LQTYGain_1wk, expectedOATHGain_1wk), 2e17)
      assert.isAtMost(getDifference(B_LQTYGain_1wk, expectedOATHGain_1wk), 2e17)
      assert.isAtMost(getDifference(C_LQTYGain_1wk, expectedOATHGain_1wk), 2e17)

      // Another week passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK, web3.currentProvider)

      // D deposits, triggering OATH gains for A,B,C. Withdraws immediately after
      await stabilityPool.provideToSP(dec(1, 18), { from: D })
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

      // Expected gains for each depositor after 2 weeks (100% total issued).  Each deposit gets 1/3 of issuance.
      const expectedOATHGain_2wk = toBN(dec(14000, 18)).div(toBN('3'))

      // Check OATH gain
      const A_LQTYGain_2wk = await stabilityPool.getDepositorLQTYGain(A)
      const B_LQTYGain_2wk = await stabilityPool.getDepositorLQTYGain(B)
      const C_LQTYGain_2wk = await stabilityPool.getDepositorLQTYGain(C)

      // Check gains are correct, error tolerance = 0.2 of a token
      assert.isAtMost(getDifference(A_LQTYGain_2wk, expectedOATHGain_2wk), 2e17)
      assert.isAtMost(getDifference(B_LQTYGain_2wk, expectedOATHGain_2wk), 2e17)
      assert.isAtMost(getDifference(C_LQTYGain_2wk, expectedOATHGain_2wk), 2e17)

      // Each depositor fully withdraws
      await stabilityPool.withdrawFromSP(dec(100, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(100, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(100, 18), { from: C })

      // Check OATH balances increase by correct amount
      assert.isAtMost(getDifference((await oathToken.balanceOf(A)), expectedOATHGain_2wk), 2e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(B)), expectedOATHGain_2wk), 2e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(C)), expectedOATHGain_2wk), 2e17)
    })

    // 3 depositors, varied stake. No liquidations.
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct OATH gain. No liquidations.", async () => {
      const initialIssuance = await communityIssuanceTester.totalOATHIssued()
      assert.equal(initialIssuance, 0)

      // Whale opens Trove with 10k ETH
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], whale, dec(10000, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(10000, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(10000, 18)), whale, whale, { from: whale })

      await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(200, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], B, dec(300, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], C, dec(400, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], D, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(10000, 18), A, A, { from: A })
      await borrowerOperations.openTrove(collaterals[0].address, dec(300, collDecimals), th._100pct, dec(20000, 18), B, B, { from: B })
      await borrowerOperations.openTrove(collaterals[0].address, dec(400, collDecimals), th._100pct, dec(30000, 18), C, C, { from: C })
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, dec(10000, 18), D, D, { from: D })

      // Check all OATH balances are initially 0
      assert.equal(await oathToken.balanceOf(A), 0)
      assert.equal(await oathToken.balanceOf(B), 0)
      assert.equal(await oathToken.balanceOf(C), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), { from: C })

      // One week passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_WEEK), web3.currentProvider)

      // D deposits, triggering OATH gains for A,B,C. Withdraws immediately after
      await stabilityPool.provideToSP(dec(1, 18), { from: D })
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

      // Expected gains for each depositor after 1 week (50% total issued)
      const A_expectedLQTYGain_1wk = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued after 1 week
        .div(toBN('6'))  // A gets 1/6 of the issuance

      const B_expectedLQTYGain_1wk = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued after 1 week
        .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

      const C_expectedLQTYGain_1wk = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued after 1 week
        .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

      // Check OATH gain
      const A_LQTYGain_1wk = await stabilityPool.getDepositorLQTYGain(A)
      const B_LQTYGain_1wk = await stabilityPool.getDepositorLQTYGain(B)
      const C_LQTYGain_1wk = await stabilityPool.getDepositorLQTYGain(C)

      // Check gains are correct, error tolerance = 0.3 of a token
      assert.isAtMost(getDifference(A_LQTYGain_1wk, A_expectedLQTYGain_1wk), 3e17)
      assert.isAtMost(getDifference(B_LQTYGain_1wk, B_expectedLQTYGain_1wk), 3e17)
      assert.isAtMost(getDifference(C_LQTYGain_1wk, C_expectedLQTYGain_1wk), 3e17)

      // Another week passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK, web3.currentProvider)

      // D deposits, triggering OATH gains for A,B,C. Withdraws immediately after
      await stabilityPool.provideToSP(dec(1, 18), { from: D })
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: D })

      // Expected gains for each depositor after 2 weeks (75% total issued).
      const A_expectedLQTYGain_2wk = toBN(dec(14000, 18))
        .div(toBN('6'))  // A gets 1/6 of the issuance

      const B_expectedLQTYGain_2wk = toBN(dec(14000, 18))
        .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

      const C_expectedLQTYGain_2wk = toBN(dec(14000, 18))
        .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

      // Check OATH gain
      const A_LQTYGain_2wk = await stabilityPool.getDepositorLQTYGain(A)
      const B_LQTYGain_2wk = await stabilityPool.getDepositorLQTYGain(B)
      const C_LQTYGain_2wk = await stabilityPool.getDepositorLQTYGain(C)

      // Check gains are correct, error tolerance = 0.3 of a token
      assert.isAtMost(getDifference(A_LQTYGain_2wk, A_expectedLQTYGain_2wk), 3e17)
      assert.isAtMost(getDifference(B_LQTYGain_2wk, B_expectedLQTYGain_2wk), 3e17)
      assert.isAtMost(getDifference(C_LQTYGain_2wk, C_expectedLQTYGain_2wk), 3e17)

      // Each depositor fully withdraws
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: C })

      // Check OATH balances increase by correct amount
      assert.isAtMost(getDifference((await oathToken.balanceOf(A)), A_expectedLQTYGain_2wk), 3e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(B)), B_expectedLQTYGain_2wk), 3e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(C)), C_expectedLQTYGain_2wk), 3e17)
    })

    // A, B, C deposit. Varied stake. 1 Liquidation. D joins.
    it("withdrawFromSP(): Depositors with varying initial deposit withdraw correct OATH gain. No liquidations.", async () => {
      const initialIssuance = await communityIssuanceTester.totalOATHIssued()
      assert.equal(initialIssuance, 0)

      // Whale opens Trove with 10k ETH
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], whale, dec(10000, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(10000, collDecimals), th._100pct, dec(10000, 18), whale, whale, { from: whale })

      await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(200, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], B, dec(300, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], C, dec(400, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], D, dec(500, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], E, dec(600, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(10000, 18), A, A, { from: A })
      await borrowerOperations.openTrove(collaterals[0].address, dec(300, collDecimals), th._100pct, dec(20000, 18), B, B, { from: B })
      await borrowerOperations.openTrove(collaterals[0].address, dec(400, collDecimals), th._100pct, dec(30000, 18), C, C, { from: C })
      await borrowerOperations.openTrove(collaterals[0].address, dec(500, collDecimals), th._100pct, dec(40000, 18), D, D, { from: D })
      await borrowerOperations.openTrove(collaterals[0].address, dec(600, collDecimals), th._100pct, dec(40000, 18), E, E, { from: E })

      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_1, dec(300, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(300, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(30000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })

      // Check all OATH balances are initially 0
      assert.equal(await oathToken.balanceOf(A), 0)
      assert.equal(await oathToken.balanceOf(B), 0)
      assert.equal(await oathToken.balanceOf(C), 0)
      assert.equal(await oathToken.balanceOf(D), 0)

      // A, B, C deposit
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), { from: C })

      // Week 1 passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_WEEK), web3.currentProvider)

      assert.equal(await stabilityPool.getTotalLUSDDeposits(), dec(60000, 18))

      // Price Drops, defaulter1 liquidated. Stability Pool size drops by 50%
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts, collaterals[0].address))
      await troveManager.liquidate(defaulter_1, collaterals[0].address)
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))

      // Confirm SP dropped from 60k to 30k
      assert.isAtMost(getDifference(await stabilityPool.getTotalLUSDDeposits(), dec(30000, 18)), 1000)

      // Expected gains for each depositor after 1 week (50% total issued)
      const A_expectedLQTYGain_W1 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in W1
        .div(toBN('6'))  // A got 1/6 of the issuance

      const B_expectedLQTYGain_W1 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in W1
        .div(toBN('3'))  // B gets 2/6 = 1/3 of the issuance

      const C_expectedLQTYGain_W1 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in W1
        .div(toBN('2'))  // C gets 3/6 = 1/2 of the issuance

      // Check OATH gain
      const A_LQTYGain_W1 = await stabilityPool.getDepositorLQTYGain(A)
      const B_LQTYGain_W1 = await stabilityPool.getDepositorLQTYGain(B)
      const C_LQTYGain_W1 = await stabilityPool.getDepositorLQTYGain(C)

      // Check gains are correct, error tolerance = 0.3 of a toke
      assert.isAtMost(getDifference(A_LQTYGain_W1, A_expectedLQTYGain_W1), 3e17)
      assert.isAtMost(getDifference(B_LQTYGain_W1, B_expectedLQTYGain_W1), 3e17)
      assert.isAtMost(getDifference(C_LQTYGain_W1, C_expectedLQTYGain_W1), 3e17)

      // D deposits 40k
      await stabilityPool.provideToSP(dec(40000, 18), { from: D })

      // Week 2 passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK, web3.currentProvider)

      // E deposits and withdraws, creating OATH issuance
      await stabilityPool.provideToSP(dec(1, 18), { from: E })
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: E })

      // Expected gains for each depositor during Y2:
      const A_expectedLQTYGain_W2 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in Y2
        .div(toBN('14'))  // A got 50/700 = 1/14 of the issuance

      const B_expectedLQTYGain_W2 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in Y2
        .div(toBN('7'))  // B got 100/700 = 1/7 of the issuance

      const C_expectedLQTYGain_W2 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in Y2
        .mul(toBN('3')).div(toBN('14'))  // C gets 150/700 = 3/14 of the issuance

      const D_expectedLQTYGain_W2 = toBN(dec(14000, 18))
        .div(toBN('2')) // 50% of total issued in Y2
        .mul(toBN('4')).div(toBN('7'))  // D gets 400/700 = 4/7 of the issuance

      // Check OATH gain
      const A_LQTYGain_AfterW2 = await stabilityPool.getDepositorLQTYGain(A)
      const B_LQTYGain_AfterW2 = await stabilityPool.getDepositorLQTYGain(B)
      const C_LQTYGain_AfterW2 = await stabilityPool.getDepositorLQTYGain(C)
      const D_LQTYGain_AfterW2 = await stabilityPool.getDepositorLQTYGain(D)

      const A_expectedTotalGain = A_expectedLQTYGain_W1.add(A_expectedLQTYGain_W2)
      const B_expectedTotalGain = B_expectedLQTYGain_W1.add(B_expectedLQTYGain_W2)
      const C_expectedTotalGain = C_expectedLQTYGain_W1.add(C_expectedLQTYGain_W2)
      const D_expectedTotalGain = D_expectedLQTYGain_W2

      // Check gains are correct, error tolerance = 0.5 of a token
      assert.isAtMost(getDifference(A_LQTYGain_AfterW2, A_expectedTotalGain), 5e17)
      assert.isAtMost(getDifference(B_LQTYGain_AfterW2, B_expectedTotalGain), 5e17)
      assert.isAtMost(getDifference(C_LQTYGain_AfterW2, C_expectedTotalGain), 5e17)
      assert.isAtMost(getDifference(D_LQTYGain_AfterW2, D_expectedTotalGain), 5e17)

      // Each depositor fully withdraws
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

      // Check OATH balances increase by correct amount
      assert.isAtMost(getDifference((await oathToken.balanceOf(A)), A_expectedTotalGain), 5e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(B)), B_expectedTotalGain), 5e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(C)), C_expectedTotalGain), 5e17)
      assert.isAtMost(getDifference((await oathToken.balanceOf(D)), D_expectedTotalGain), 5e17)
    })

    //--- Serial pool-emptying liquidations ---

    /* A, B deposit 100C
    L1 cancels 200C
    B, C deposits 100C
    L2 cancels 200C
    E, F deposit 100C
    L3 cancels 200C
    G,H deposits 100C
    L4 cancels 200C */
    it('withdrawFromSP(): Depositor withdraws correct OATH gain after serial pool-emptying liquidations.', async () => {
      const initialIssuance = await communityIssuanceTester.totalOATHIssued()
      assert.equal(initialIssuance, 0)

      // Whale opens Trove with 10k ETH
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], whale, dec(10000, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(10000, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(10000, 18)), whale, whale, { from: whale })

      const allDepositors = [A, B, C, D, E, F, G, H]
      // 4 Defaulters open trove with 200LUSD debt, and 200% ICR
      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_1, dec(200, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_2, dec(200, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_3, dec(200, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_4, dec(200, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(20000, 18)), defaulter_1, defaulter_1, { from: defaulter_1 })
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(20000, 18)), defaulter_2, defaulter_2, { from: defaulter_2 })
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(20000, 18)), defaulter_3, defaulter_3, { from: defaulter_3 })
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(20000, 18)), defaulter_4, defaulter_4, { from: defaulter_4 })

      // price drops by 50%: defaulter ICR falls to 100%
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18));

      // Check all would-be depositors have 0 OATH balance
      for (depositor of allDepositors) {
        assert.equal(await oathToken.balanceOf(depositor), '0')
      }

      // A, B each deposit 10k LUSD
      const depositors_1 = [A, B]
      for (account of depositors_1) {
        await mintCollateralAndApproveBorrowerOps(collaterals[0], account, dec(200, collDecimals))
        await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(10000, 18), account, account, { from: account })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      // 1 day passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_DAY), web3.currentProvider)

      // Defaulter 1 liquidated. 20k LUSD fully offset with pool.
      await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner });

      // C, D each deposit 10k LUSD
      const depositors_2 = [C, D]
      for (account of depositors_2) {
        await mintCollateralAndApproveBorrowerOps(collaterals[0], account, dec(200, collDecimals))
        await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(10000, 18), account, account, { from: account })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 2 liquidated. 10k LUSD offset
      await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner });

      // Erin, Flyn each deposit 100 LUSD
      const depositors_3 = [E, F]
      for (account of depositors_3) {
        await mintCollateralAndApproveBorrowerOps(collaterals[0], account, dec(200, collDecimals))
        await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(10000, 18), account, account, { from: account })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 3 liquidated. 100 LUSD offset
      await troveManager.liquidate(defaulter_3, collaterals[0].address, { from: owner });

      // Graham, Harriet each deposit 10k LUSD
      const depositors_4 = [G, H]
      for (account of depositors_4) {
        await mintCollateralAndApproveBorrowerOps(collaterals[0], account, dec(200, collDecimals))
        await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(10000, 18), account, account, { from: account })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 4 liquidated. 100 LUSD offset
      await troveManager.liquidate(defaulter_4, collaterals[0].address, { from: owner });

      // All depositors withdraw from SP
      for (depositor of allDepositors) {
        await stabilityPool.withdrawFromSP(dec(10000, 18), { from: depositor })
      }

      /* Each depositor constitutes 50% of the pool from the time they deposit, up until the liquidation.
      Therefore, divide daily issuance by 2 to get the expected per-depositor OATH gain.*/
      const expectedOATHGain_D1 = toBN(dec(1000, 18)).div(th.toBN('2'))
      const expectedOATHGain_D2 = toBN(dec(1000, 18)).div(th.toBN('2'))
      const expectedOATHGain_D3 = toBN(dec(1000, 18)).div(th.toBN('2'))
      const expectedOATHGain_D4 = toBN(dec(1000, 18)).div(th.toBN('2'))

      // Check A, B only earn issuance from day 1. Error tolerance = 1e-3 tokens
      for (depositor of [A, B]) {
        const OATHBalance = await oathToken.balanceOf(depositor)
        assert.isAtMost(getDifference(OATHBalance, expectedOATHGain_D1), 3e17)
      }

      // Check C, D only earn issuance from day 2.  Error tolerance = 1e-3 tokens
      for (depositor of [C, D]) {
        const OATHBalance = await oathToken.balanceOf(depositor)
        assert.isAtMost(getDifference(OATHBalance, expectedOATHGain_D2), 3e17)
      }

      // Check E, F only earn issuance from day 3.  Error tolerance = 1e-3 tokens
      for (depositor of [E, F]) {
        const OATHBalance = await oathToken.balanceOf(depositor)
        assert.isAtMost(getDifference(OATHBalance, expectedOATHGain_D3), 3e17)
      }

      // Check G, H only earn issuance from day 4.  Error tolerance = 1e-3 tokens
      for (depositor of [G, H]) {
        const OATHBalance = await oathToken.balanceOf(depositor)
        assert.isAtMost(getDifference(OATHBalance, expectedOATHGain_D4), 3e17)
      }

      const finalEpoch = (await stabilityPool.currentEpoch()).toString()
      assert.equal(finalEpoch, 4)
    })

    it('OATH issuance for a given period is not obtainable if the SP was empty during the period', async () => {
      const CIBalanceBefore = await oathToken.balanceOf(communityIssuanceTester.address)

      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(200, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], B, dec(100, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], C, dec(200, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(16000, 18), A, A, { from: A })
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, dec(10000, 18), B, B, { from: B })
      await borrowerOperations.openTrove(collaterals[0].address, dec(200, collDecimals), th._100pct, dec(16000, 18), C, C, { from: C })

      const totalOATHissuance_0 = await communityIssuanceTester.totalOATHIssued()
      const G_0 = await stabilityPool.epochToScaleToG(0, 0)  // epochs and scales will not change in this test: no liquidations
      assert.equal(totalOATHissuance_0, '0')
      assert.equal(G_0, '0')

      // 1 day passes (D1)
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_DAY), web3.currentProvider)

      // OATH issuance event triggered: A deposits
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })

      // Check G is not updated, since SP was empty prior to A's deposit
      const G_1 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_1.eq(G_0))

      // Check total OATH issued is updated
      const totalOATHissuance_1 = await communityIssuanceTester.totalOATHIssued()
      assert.isTrue(totalOATHissuance_1.gt(totalOATHissuance_0))

      // 1 day passes (D2)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      //OATH issuance event triggered: A withdraws. 
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })

      // Check G is updated, since SP was not empty prior to A's withdrawal
      const G_2 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_2.gt(G_1))

      // Check total OATH issued is updated
      const totalOATHissuance_2 = await communityIssuanceTester.totalOATHIssued()
      assert.isTrue(totalOATHissuance_2.gt(totalOATHissuance_1))

      // 1 day passes (D3)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // OATH issuance event triggered: C deposits
      await stabilityPool.provideToSP(dec(10000, 18), { from: C })

      // Check G is not updated, since SP was empty prior to C's deposit
      const G_3 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_3.eq(G_2))

      // Check total OATH issued is updated
      const totalOATHissuance_3 = await communityIssuanceTester.totalOATHIssued()
      assert.isTrue(totalOATHissuance_3.gt(totalOATHissuance_2))

      // 1 day passes (D4)
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // C withdraws
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: C })

      // Check G is increased, since SP was not empty prior to C's withdrawal
      const G_4 = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(G_4.gt(G_3))

      // Check total OATH issued is increased
      const totalOATHissuance_4 = await communityIssuanceTester.totalOATHIssued()
      assert.isTrue(totalOATHissuance_4.gt(totalOATHissuance_3))

      // Get OATH Gains
      const A_OATHGain = await oathToken.balanceOf(A)
      const C_OATHGain = await oathToken.balanceOf(C)

      // Check A earns gains from D2 only
      assert.isAtMost(getDifference(A_OATHGain, toBN(dec(1000, 18))), 1e17)

      // Check C earns gains from D4 only
      assert.isAtMost(getDifference(C_OATHGain, toBN(dec(1000, 18))), 1e17)

      // Check totalOATHIssued = D1 + D2 + D3 + D4.  1e-3 error tolerance.
      const expectedIssuance4Days = toBN(dec(4000, 18))
      assert.isAtMost(getDifference(expectedIssuance4Days, totalOATHissuance_4), 3e17)

      // Check CI has only transferred out tokens for D2 + D4.  1e-3 error tolerance.
      const expectedOATHSentOutFromCI = toBN(dec(2000, 18))
      const CIBalanceAfter = await oathToken.balanceOf(communityIssuanceTester.address)
      const CIBalanceDifference = CIBalanceBefore.sub(CIBalanceAfter)
      assert.isAtMost(getDifference(CIBalanceDifference, expectedOATHSentOutFromCI), 3e17)
    })


    // --- Scale factor changes ---

    /* Serial scale changes

    A make deposit 10k LUSD
    1 day passes. L1 decreases P: P = 1e-5 P. L1:   9999.9 LUSD, 100 ETH
    B makes deposit 9999.9
    1 day passes. L2 decreases P: P =  1e-5 P. L2:  9999.9 LUSD, 100 ETH
    C makes deposit  9999.9
    1 day passes. L3 decreases P: P = 1e-5 P. L3:  9999.9 LUSD, 100 ETH
    D makes deposit  9999.9
    1 day passes. L4 decreases P: P = 1e-5 P. L4:  9999.9 LUSD, 100 ETH
    E makes deposit  9999.9
    1 day passes. L5 decreases P: P = 1e-5 P. L5:  9999.9 LUSD, 100 ETH
    =========
    F makes deposit 100
    1 day passes. L6 empties the Pool. L6:  10000 LUSD, 100 ETH

    expect A, B, C, D each withdraw ~1 day's worth of OATH */
    it("withdrawFromSP(): Several deposits of 100 LUSD span one scale factor change. Depositors withdraw correct OATH gains", async () => {
      // Whale opens Trove with 100 ETH
      const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], whale, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(10000, 18)), whale, whale, { from: whale })

      const fiveDefaulters = [defaulter_1, defaulter_2, defaulter_3, defaulter_4, defaulter_5]

      await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(10000, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], B, dec(10000, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], C, dec(10000, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], D, dec(10000, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], E, dec(10000, collDecimals))
      await mintCollateralAndApproveBorrowerOps(collaterals[0], F, dec(10000, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: A })
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: B })
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: C })
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: D })
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: E })
      await borrowerOperations.openTrove(collaterals[0].address, dec(1000, collDecimals), th._100pct, dec(10000, 18), ZERO_ADDRESS, ZERO_ADDRESS, { from: F })

      for (const defaulter of fiveDefaulters) {
        // Defaulters 1-5 each withdraw to 9999.9 debt (including gas comp)
        await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter, dec(100, collDecimals))
        await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, await getOpenTroveLUSDAmount('9999900000000000000000'), defaulter, defaulter, { from: defaulter })
      }

      // Defaulter 6 withdraws to 10k debt (inc. gas comp)
      await mintCollateralAndApproveBorrowerOps(collaterals[0], defaulter_6, dec(100, collDecimals))
      await borrowerOperations.openTrove(collaterals[0].address, dec(100, collDecimals), th._100pct, await getOpenTroveLUSDAmount(dec(10000, 18)), defaulter_6, defaulter_6, { from: defaulter_6 })

      // Confirm all depositors have 0 OATH
      for (const depositor of [A, B, C, D, E, F]) {
        assert.equal(await oathToken.balanceOf(depositor), '0')
      }
      // price drops by 50%
      await priceFeed.setPrice(collaterals[0].address, dec(100, 18));

      // Check scale is 0
      // assert.equal(await stabilityPool.currentScale(), '0')

      // A provides to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })

      // 1 day passes
      await th.fastForwardTime(await getDuration(timeValues.SECONDS_IN_ONE_DAY), web3.currentProvider)

      // Defaulter 1 liquidated.  Value of P updated to  to 1e-5
      const txL1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner });
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_1))
      assert.isTrue(txL1.receipt.status)

      // Check scale is 0
      assert.equal(await stabilityPool.currentScale(), '0')
      assert.equal(await stabilityPool.P(), dec(1, 13)) //P decreases: P = 1e(18-5) = 1e13

      // B provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), { from: B })

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 2 liquidated
      const txL2 = await troveManager.liquidate(defaulter_2, collaterals[0].address, { from: owner });
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_2))
      assert.isTrue(txL2.receipt.status)

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), '1')
      assert.equal(await stabilityPool.P(), dec(1, 17)) //Scale changes and P changes: P = 1e(13-5+9) = 1e17

      // C provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), { from: C })

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 3 liquidated
      const txL3 = await troveManager.liquidate(defaulter_3, collaterals[0].address, { from: owner });
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_3))
      assert.isTrue(txL3.receipt.status)

      // Check scale is 1
      assert.equal(await stabilityPool.currentScale(), '1')
      assert.equal(await stabilityPool.P(), dec(1, 12)) //P decreases: P 1e(17-5) = 1e12

      // D provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), { from: D })

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 4 liquidated
      const txL4 = await troveManager.liquidate(defaulter_4, collaterals[0].address, { from: owner });
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_4))
      assert.isTrue(txL4.receipt.status)

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), '2')
      assert.equal(await stabilityPool.P(), dec(1, 16)) //Scale changes and P changes:: P = 1e(12-5+9) = 1e16

      // E provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), { from: E })

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      // Defaulter 5 liquidated
      const txL5 = await troveManager.liquidate(defaulter_5, collaterals[0].address, { from: owner });
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_5))
      assert.isTrue(txL5.receipt.status)

      // Check scale is 2
      assert.equal(await stabilityPool.currentScale(), '2')
      assert.equal(await stabilityPool.P(), dec(1, 11)) // P decreases: P = 1e(16-5) = 1e11

      // F provides to SP
      await stabilityPool.provideToSP(dec(99999, 17), { from: F })

      // 1 day passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_DAY, web3.currentProvider)

      assert.equal(await stabilityPool.currentEpoch(), '0')

      // Defaulter 6 liquidated
      const txL6 = await troveManager.liquidate(defaulter_6, collaterals[0].address, { from: owner });
      assert.isFalse(await sortedTroves.contains(collaterals[0].address, defaulter_6))
      assert.isTrue(txL6.receipt.status)

      // Check scale is 0, epoch is 1
      assert.equal(await stabilityPool.currentScale(), '0')
      assert.equal(await stabilityPool.currentEpoch(), '1')
      assert.equal(await stabilityPool.P(), dec(1, 18)) // P resets to 1e18 after pool-emptying

      // price doubles
      await priceFeed.setPrice(collaterals[0].address, dec(200, 18));

      /* All depositors withdraw fully from SP.  Withdraw in reverse order, so that the largest remaining
      deposit (F) withdraws first, and does not get extra OATH gains from the periods between withdrawals */
      for (depositor of [F, E, D, C, B, A]) {
        await stabilityPool.withdrawFromSP(dec(10000, 18), { from: depositor })
      }

      const OATHGain_A = await oathToken.balanceOf(A)
      const OATHGain_B = await oathToken.balanceOf(B)
      const OATHGain_C = await oathToken.balanceOf(C)
      const OATHGain_D = await oathToken.balanceOf(D)
      const OATHGain_E = await oathToken.balanceOf(E)
      const OATHGain_F = await oathToken.balanceOf(F)

      /* Expect each deposit to have earned 100% of the OATH issuance for the day in which it was active, prior
     to the liquidation that mostly depleted it.  Error tolerance = 1e-3 tokens. */

      assert.isAtMost(getDifference(toBN(dec(1000, 18)), OATHGain_A), 8e17)
      assert.isAtMost(getDifference(toBN(dec(1000, 18)), OATHGain_B), 8e17)
      assert.isAtMost(getDifference(toBN(dec(1000, 18)), OATHGain_C), 8e17)
      assert.isAtMost(getDifference(toBN(dec(1000, 18)), OATHGain_D), 8e17)

      assert.isAtMost(getDifference(toBN(dec(1000, 18)), OATHGain_E), 8e17)
      assert.isAtMost(getDifference(toBN(dec(1000, 18)), OATHGain_F), 8e17)
    })
  })
})

contract('Reset chain state', async accounts => { })
