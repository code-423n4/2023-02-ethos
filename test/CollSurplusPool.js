const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const NonPayable = artifacts.require('NonPayable.sol')

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const TroveManagerTester = artifacts.require("TroveManagerTester")
const LUSDToken = artifacts.require("LUSDToken")

contract('CollSurplusPool', async accounts => {
  const [
    owner,
    A, B, C, D, E] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let borrowerOperations
  let priceFeed
  let collSurplusPool

  let contracts
  let collaterals

  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts = await deploymentHelper.deployTestCollaterals(contracts)
    contracts.troveManager = await TroveManagerTester.new()
    contracts.lusdToken = await LUSDToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.governance.address,
      contracts.guardian.address
    )
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = contracts.priceFeedTestnet
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    collaterals = contracts.collaterals

    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
  })

  it("CollSurplusPool::getCollateral(): Returns the collateral balance of the CollSurplusPool after redemption", async () => {
    const Coll_1 = await collSurplusPool.getCollateral(collaterals[0].address)
    assert.equal(Coll_1, '0')

    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(collaterals[0].address, price)

    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const { collateral: B_coll, netDebt: B_netDebt } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(200, 16)), extraParams: { from: B } })
    await openTrove({ collateral: collaterals[0], value: toBN(dec(3000, collDecimals)), extraLUSDAmount: B_netDebt, extraParams: { from: A } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // At ETH:USD = 100, this redemption should leave 1 ether of coll surplus
    await th.redeemCollateralAndGetTxObject(A, collaterals[0].address, contracts, B_netDebt)

    const Coll_2 = await collSurplusPool.getCollateral(collaterals[0].address)
    th.assertIsApproximatelyEqual(Coll_2, B_coll.sub(B_netDebt.mul(mv._1e18BN).div(price).div(toBN(10).pow(toBN(6))))) // scale down to 12 decimals
  })

  it("CollSurplusPool: claimColl(): Reverts if caller is not Borrower Operations", async () => {
    await th.assertRevert(collSurplusPool.claimColl(A, collaterals[0].address, { from: A }), 'CollSurplusPool: Caller is not Borrower Operations')
  })

  it("CollSurplusPool: claimColl(): Reverts if nothing to claim", async () => {
    await th.assertRevert(borrowerOperations.claimCollateral(collaterals[0].address, { from: A }), 'CollSurplusPool: No collateral available to claim')
  })

  it('CollSurplusPool: reverts trying to pull collateral from ActivePool if caller not ActivePool', async () => {
    await th.assertRevert(collSurplusPool.pullCollateralFromActivePool(collaterals[0].address, dec(1, 'ether'), { from: A }), 'CollSurplusPool: Caller is not Active Pool')
  })

  it('CollSurplusPool: accountSurplus: reverts if caller is not Trove Manager', async () => {
    await th.assertRevert(collSurplusPool.accountSurplus(A, collaterals[0].address, 1), 'CollSurplusPool: Caller is not TroveManager')
  })
})

contract('Reset chain state', async accounts => { })
