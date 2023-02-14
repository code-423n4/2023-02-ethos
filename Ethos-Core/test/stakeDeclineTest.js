const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const LUSDTokenTester = artifacts.require("./LUSDTokenTester.sol")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues


/* NOTE: Some tests involving ETH redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific ETH gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the TroveManager, which is still TBD based on economic modelling.
 * 
 */
contract('TroveManager', async accounts => {

  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const [owner, A, B, C, D, E, F] = accounts.slice(0, 7);

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let collSurplusPool
  let defaultPool
  let borrowerOperations
  let hintHelpers
  let collaterals

  let contracts

  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
 
  const getSnapshotsRatio = async () => {
    const ratio = (await troveManager.totalStakesSnapshot(collaterals[0].address))
      .mul(toBN(dec(1, 18)))
      .div((await troveManager.totalCollateralSnapshot(collaterals[0].address)))

    return ratio
  }

  const mintCollateralAndApproveBorrowerOps = async (collateral, user, amount) => {
    await collateral.mint(user, amount)
    await collateral.approveInternal(user, borrowerOperations.address, amount)
  }

  beforeEach(async () => {
    contracts = await deploymentHelper.deployTestCollaterals(await deploymentHelper.deployLiquityCore())
    contracts.troveManager = await TroveManagerTester.new()
    contracts.lusdToken = await LUSDTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.governance.address,
      contracts.guardian.address
    )
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = contracts.priceFeedTestnet
    lusdToken = contracts.lusdToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers
    collaterals = contracts.collaterals

    lqtyStaking = LQTYContracts.lqtyStaking
    lqtyToken = LQTYContracts.lqtyToken
    communityIssuance = LQTYContracts.communityIssuance
    lockupContractFactory = LQTYContracts.lockupContractFactory

    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
  })

  it("A given trove's stake decline is negligible with adjustments and tiny liquidations", async () => {
    await priceFeed.setPrice(collaterals[0].address, dec(100, 18))
  
    // Make 1 mega troves A at ~50% total collateral
    await mintCollateralAndApproveBorrowerOps(collaterals[0], A, dec(2, 23))
    await borrowerOperations.openTrove(collaterals[0].address, dec(2, 23), th._100pct, await getOpenTroveLUSDAmount(dec(1, 31)), ZERO_ADDRESS, ZERO_ADDRESS, { from: A })
    
    // Make 5 large troves B, C, D, E, F at ~10% total collateral
    await mintCollateralAndApproveBorrowerOps(collaterals[0], B, dec(4, 22))
    await borrowerOperations.openTrove(collaterals[0].address, dec(4, 22), th._100pct, await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: B })
    await mintCollateralAndApproveBorrowerOps(collaterals[0], C, dec(4, 22))
    await borrowerOperations.openTrove(collaterals[0].address, dec(4, 22), th._100pct, await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: C })
    await mintCollateralAndApproveBorrowerOps(collaterals[0], D, dec(4, 22))
    await borrowerOperations.openTrove(collaterals[0].address, dec(4, 22), th._100pct, await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: D })
    await mintCollateralAndApproveBorrowerOps(collaterals[0], E, dec(4, 22))
    await borrowerOperations.openTrove(collaterals[0].address, dec(4, 22), th._100pct, await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: E })
    await mintCollateralAndApproveBorrowerOps(collaterals[0], F, dec(4, 22))
    await borrowerOperations.openTrove(collaterals[0].address, dec(4, 22), th._100pct, await getOpenTroveLUSDAmount(dec(2, 30)), ZERO_ADDRESS, ZERO_ADDRESS, { from: F })
  
    // Make 10 tiny troves at relatively negligible collateral (~1e-9 of total)
    const tinyTroves = accounts.slice(10, 20)
    for (account of tinyTroves) {
      await mintCollateralAndApproveBorrowerOps(collaterals[0], account, dec(2, 14))
      await borrowerOperations.openTrove(collaterals[0].address, dec(2, 14), th._100pct, await getOpenTroveLUSDAmount(dec(1, 22)), ZERO_ADDRESS, ZERO_ADDRESS, { from: account })
    }

    // liquidate 1 trove at ~50% total system collateral
    await priceFeed.setPrice(collaterals[0].address, dec(50, 18))
    assert.isTrue(await troveManager.checkRecoveryMode(collaterals[0].address, await priceFeed.getPrice(collaterals[0].address)))
    await troveManager.liquidate(A, collaterals[0].address)

    console.log(`totalStakesSnapshot after L1: ${await troveManager.totalStakesSnapshot(collaterals[0].address)}`)
    console.log(`totalCollateralSnapshot after L1: ${await troveManager.totalCollateralSnapshot(collaterals[0].address)}`)
    console.log(`Snapshots ratio after L1: ${await getSnapshotsRatio()}`)
    console.log(`B pending ETH reward after L1: ${await troveManager.getPendingCollateralReward(B, collaterals[0].address)}`)
    console.log(`B stake after L1: ${(await troveManager.Troves(B, collaterals[0].address))[2]}`)

    // adjust trove B 1 wei: apply rewards
    await borrowerOperations.adjustTrove(collaterals[0].address, th._100pct, 0, 0, 1, false, ZERO_ADDRESS, ZERO_ADDRESS, {from: B})  // B repays 1 wei
    console.log(`B stake after A1: ${(await troveManager.Troves(B, collaterals[0].address))[2]}`)
    console.log(`Snapshots ratio after A1: ${await getSnapshotsRatio()}`)

    // Loop over tiny troves, and alternately:
    // - Liquidate a tiny trove
    // - Adjust B's collateral by 1 wei
    for (let [idx, trove] of tinyTroves.entries()) {
      await troveManager.liquidate(trove, collaterals[0].address)
      console.log(`B stake after L${idx + 2}: ${(await troveManager.Troves(B, collaterals[0].address))[2]}`)
      console.log(`Snapshots ratio after L${idx + 2}: ${await getSnapshotsRatio()}`)
      await borrowerOperations.adjustTrove(collaterals[0].address, th._100pct, 0, 0, 1, false, ZERO_ADDRESS, ZERO_ADDRESS, {from: B})  // A repays 1 wei
      console.log(`B stake after A${idx + 2}: ${(await troveManager.Troves(B, collaterals[0].address))[2]}`)
    }
  })

  // TODO: stake decline for adjustments with sizable liquidations, for comparison
})