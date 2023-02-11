const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const TroveManagerTester = artifacts.require("TroveManagerTester")

const th = testHelpers.TestHelper

const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const assertRevert = th.assertRevert

const GAS_PRICE = 10000000


const {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  LQTYStakingProxy
} = require('../utils/proxyHelpers.js')

contract('BorrowerWrappers', async accounts => {

  const [
    owner, alice, bob, carol, dennis, whale,
    A, B, C, D, E,
    defaulter_1, defaulter_2,
    // frontEnd_1, frontEnd_2, frontEnd_3
  ] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManagerOriginal
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let collSurplusPool
  let borrowerOperations
  let borrowerWrappers
  let stakingToken
  let oathToken
  let lqtyStaking

  let contracts
  let collaterals
  let communityIssuance

  let LUSD_GAS_COMPENSATION

  const getOpenTroveLUSDAmount = async (totalDebt) => th.getOpenTroveLUSDAmount(contracts, totalDebt)
  const getActualDebtFromComposite = async (compositeDebt) => th.getActualDebtFromComposite(compositeDebt, contracts)
  const getNetBorrowingAmount = async (debtWithFee) => th.getNetBorrowingAmount(contracts, debtWithFee)
  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployTestCollaterals(await deploymentHelper.deployLiquityCore())
    contracts.troveManager = await TroveManagerTester.new()
    contracts = await deploymentHelper.deployLUSDToken(contracts)
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(multisig)
    // Hack here to make stakingToken be OATH as well..
    // Otherwise the compound operations in BorrowerWrapperScript don't quite work
    LQTYContracts.stakingToken = LQTYContracts.oathToken

    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)

    troveManagerOriginal = contracts.troveManager
    stakingToken = LQTYContracts.stakingToken

    const users = [ alice, bob, carol, dennis, whale, A, B, C, D, E, defaulter_1, defaulter_2 ]
    await deploymentHelper.deployProxyScripts(contracts, LQTYContracts, owner, users)

    priceFeed = contracts.priceFeedTestnet
    lusdToken = contracts.lusdToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    borrowerWrappers = contracts.borrowerWrappers
    lqtyStaking = LQTYContracts.lqtyStaking
    oathToken = LQTYContracts.stakingToken
    communityIssuance = LQTYContracts.communityIssuance
    collaterals = contracts.collaterals

    LUSD_GAS_COMPENSATION = await borrowerOperations.LUSD_GAS_COMPENSATION()
  })

  it('proxy owner can recover ERC20', async () => {
    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const amount = toBN(dec(1, collDecimals))
    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)

    // send some tokens to proxy
    await collaterals[0].mint(owner, amount);
    await collaterals[0].transferInternal(owner, proxyAddress, amount);
    assert.equal(await collaterals[0].balanceOf(proxyAddress), amount.toString())

    const balanceBefore = toBN(await collaterals[0].balanceOf(alice))

    // recover tokens
    await borrowerWrappers.transferERC20(collaterals[0].address, alice, amount, { from: alice })
    
    const balanceAfter = toBN(await collaterals[0].balanceOf(alice))
    assert.equal(balanceAfter.sub(balanceBefore), amount.toString())
  })

  it('non proxy owner cannot recover ERC20', async () => {
    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const amount = toBN(dec(1, collDecimals))
    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)

    // send some tokens to proxy
    await collaterals[0].mint(owner, amount);
    await collaterals[0].transferInternal(owner, proxyAddress, amount);
    assert.equal(await collaterals[0].balanceOf(proxyAddress), amount.toString())

    const balanceBefore = toBN(await collaterals[0].balanceOf(alice))

    // try to recover tokens
    const proxy = borrowerWrappers.getProxyFromUser(alice)
    const signature = 'transferERC20(address,address,uint256)'
    const calldata = th.getTransactionData(signature, [alice, amount])
    await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')

    assert.equal(await collaterals[0].balanceOf(proxyAddress), amount.toString())
    
    const balanceAfter = toBN(await collaterals[0].balanceOf(alice))
    assert.equal(balanceAfter, balanceBefore.toString())
  })

  // --- claimCollateralAndOpenTrove ---

  it('claimCollateralAndOpenTrove(): reverts if nothing to claim', async () => {
    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens Trove
    const { lusdAmount, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(15, 17)), extraParams: { from: alice } })

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // alice claims collateral and re-opens the trove
    await assertRevert(
      borrowerWrappers.claimCollateralAndOpenTrove(collaterals[0].address, 0, th._100pct, lusdAmount, alice, alice, { from: alice }),
      'CollSurplusPool: No collateral available to claim'
    )

    // check everything remain the same
    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await collSurplusPool.getUserCollateral(proxyAddress, collaterals[0].address), '0')
    th.assertIsApproximatelyEqual(await lusdToken.balanceOf(proxyAddress), lusdAmount)
    assert.equal(await troveManager.getTroveStatus(proxyAddress, collaterals[0].address), 1)
    th.assertIsApproximatelyEqual(await troveManager.getTroveColl(proxyAddress, collaterals[0].address), collateral)
  })

  it('claimCollateralAndOpenTrove(): without sending any value', async () => {
    // alice opens Trove
    const { lusdAmount, netDebt: redeemAmount, collateral } = await openTrove({ collateral: collaterals[0], extraLUSDAmount: 0, ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: redeemAmount, ICR: toBN(dec(5, 18)), extraParams: { from: whale } })

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 150 LUSD
    await th.redeemCollateral(whale, collaterals[0].address, contracts, redeemAmount, GAS_PRICE)
    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')

    // surplus: 5 - 150/200
    const price = await priceFeed.getPrice(collaterals[0].address);
    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const expectedSurplus = collateral.sub(redeemAmount.mul(toBN(10).pow(collDecimals)).div(price))
    th.assertIsApproximatelyEqual(await collSurplusPool.getUserCollateral(proxyAddress, collaterals[0].address), expectedSurplus)
    assert.equal(await troveManager.getTroveStatus(proxyAddress, collaterals[0].address), 4) // closed by redemption

    // alice claims collateral and re-opens the trove
    await borrowerWrappers.claimCollateralAndOpenTrove(collaterals[0].address, 0, th._100pct, lusdAmount, alice, alice, { from: alice })

    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await collSurplusPool.getUserCollateral(proxyAddress, collaterals[0].address), '0')
    th.assertIsApproximatelyEqual(await lusdToken.balanceOf(proxyAddress), lusdAmount.mul(toBN(2)))
    assert.equal(await troveManager.getTroveStatus(proxyAddress, collaterals[0].address), 1)
    th.assertIsApproximatelyEqual(await troveManager.getTroveColl(proxyAddress, collaterals[0].address), expectedSurplus)
  })

  it('claimCollateralAndOpenTrove(): sending value in the transaction', async () => {
    // alice opens Trove
    const { lusdAmount, netDebt: redeemAmount, collateral } = await openTrove({ collateral: collaterals[0], extraParams: { from: alice } })
    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: redeemAmount, ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 150 LUSD
    await th.redeemCollateral(whale, collaterals[0].address, contracts, redeemAmount, GAS_PRICE)
    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')

    // surplus: 5 - 150/200
    const price = await priceFeed.getPrice(collaterals[0].address);
    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const expectedSurplus = collateral.sub(redeemAmount.mul(toBN(10).pow(collDecimals)).div(price))
    th.assertIsApproximatelyEqual(await collSurplusPool.getUserCollateral(proxyAddress, collaterals[0].address), expectedSurplus)
    assert.equal(await troveManager.getTroveStatus(proxyAddress, collaterals[0].address), 4) // closed by redemption

    // alice claims collateral and re-opens the trove
    await collaterals[0].mint(alice, collateral)
    await collaterals[0].approveInternal(alice, proxyAddress, collateral)
    await borrowerWrappers.claimCollateralAndOpenTrove(collaterals[0].address, collateral, th._100pct, lusdAmount, alice, alice, { from: alice })

    assert.equal(await collaterals[0].balanceOf(proxyAddress), '0')
    th.assertIsApproximatelyEqual(await collSurplusPool.getUserCollateral(proxyAddress, collaterals[0].address), '0')
    th.assertIsApproximatelyEqual(await lusdToken.balanceOf(proxyAddress), lusdAmount.mul(toBN(2)))
    assert.equal(await troveManager.getTroveStatus(proxyAddress, collaterals[0].address), 1)
    th.assertIsApproximatelyEqual(await troveManager.getTroveColl(proxyAddress, collaterals[0].address), expectedSurplus.add(collateral))
  })

  // --- claimSPRewardsAndRecycle ---

  it('claimSPRewardsAndRecycle(): only owner can call it', async () => {
    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
    // Whale deposits 1850 LUSD in StabilityPool
    await stabilityPool.provideToSP(dec(1850, 18), { from: whale })

    // alice opens trove and provides 150 LUSD to StabilityPool
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), { from: alice })

    // Defaulter Trove opened
    await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

    // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(collaterals[0].address, price);

    // Defaulter trove closed
    const liquidationTX_1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })
    const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)

    // Bob tries to claims SP rewards in behalf of Alice
    const proxy = borrowerWrappers.getProxyFromUser(alice)
    const signature = 'claimSPRewardsAndRecycle(address,uint256,address,address)'
    const calldata = th.getTransactionData(signature, [collaterals[0].address, th._100pct, alice, alice])
    await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')
  })

  it('claimSPRewardsAndRecycle():', async () => {
    await stakingToken.mint(owner, toBN(dec(14000, 18)));
    await stakingToken.approve(communityIssuance.address, toBN(dec(14000, 18)), {from: owner});
    await communityIssuance.fund(toBN(dec(14000, 18)), {from: owner});

    // Whale opens Trove
    const whaleDeposit = toBN(dec(2350, 18))
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: whaleDeposit, ICR: toBN(dec(4, 18)), extraParams: { from: whale } })
    // Whale deposits 2350 LUSD in StabilityPool
    await stabilityPool.provideToSP(whaleDeposit, { from: whale })

    // alice opens trove and provides 150 LUSD to StabilityPool
    const aliceDeposit = toBN(dec(150, 18))
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: aliceDeposit, ICR: toBN(dec(3, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(aliceDeposit, { from: alice })

    // Defaulter Trove opened
    const { lusdAmount, netDebt, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

    // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
    const price = toBN(dec(100, 18))
    await priceFeed.setPrice(collaterals[0].address, price);

    // Defaulter trove closed
    const liquidationTX_1 = await troveManager.liquidate(defaulter_1, collaterals[0].address, { from: owner })
    const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)

    // Alice LUSDLoss is ((150/2500) * liquidatedDebt)
    const totalDeposits = whaleDeposit.add(aliceDeposit)
    const expectedLUSDLoss_A = liquidatedDebt_1.mul(aliceDeposit).div(totalDeposits)

    const expectedCompoundedLUSDDeposit_A = toBN(dec(150, 18)).sub(expectedLUSDLoss_A)
    const compoundedLUSDDeposit_A = await stabilityPool.getCompoundedLUSDDeposit(alice)
    // collateral * 150 / 2500 * 0.995
    const expectedETHGain_A = collateral.mul(aliceDeposit).div(totalDeposits).mul(toBN(dec(995, 15))).div(mv._1e18BN)

    assert.isAtMost(th.getDifference(expectedCompoundedLUSDDeposit_A, compoundedLUSDDeposit_A), 1000)

    const collBalanceBefore = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceBefore = await lusdToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceBefore = await oathToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositBefore = await stabilityPool.deposits(alice)
    const stakeBefore = await lqtyStaking.stakes(alice)

    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    let scaledETHGain_A = expectedETHGain_A;
    if (collDecimals.gt(toBN(18))) {
      scaledETHGain_A = scaledETHGain_A.div(toBN(10).pow(collDecimals.sub(toBN(18))))
    } else if (collDecimals.lt(toBN(18))) {
      scaledETHGain_A = scaledETHGain_A.mul(toBN(10).pow(toBN(18).sub(collDecimals)))
    }
    const proportionalLUSD = scaledETHGain_A.mul(price).div(ICRBefore)
    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay()
    const netDebtChange = proportionalLUSD.mul(mv._1e18BN).div(mv._1e18BN.add(borrowingRate))

    // to force OATH issuance
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK, web3.currentProvider)

    const expectedLQTYGain_A = toBN(dec(7000, 18)).mul(toBN(150)).div(toBN(2500))

    await priceFeed.setPrice(collaterals[0].address, price.mul(toBN(2)));

    // Alice claims SP rewards and puts them back in the system through the proxy
    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    await borrowerWrappers.claimSPRewardsAndRecycle(collaterals[0].address, th._100pct, alice, alice, { from: alice })

    const collBalanceAfter = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceAfter = await lusdToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceAfter = await oathToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositAfter = await stabilityPool.deposits(alice)
    const stakeAfter = await lqtyStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(collBalanceAfter.toString(), collBalanceBefore.toString())
    assert.equal(lusdBalanceAfter.toString(), lusdBalanceBefore.toString())
    assert.equal(lqtyBalanceAfter.toString(), lqtyBalanceBefore.toString())
    // check trove has increased debt by the ICR proportional amount to ETH gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore.add(proportionalLUSD))
    // check trove has increased collateral by the ETH gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore.add(expectedETHGain_A))
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.sub(expectedLUSDLoss_A).add(netDebtChange))
    // check lqty balance remains the same
    th.assertIsApproximatelyEqual(lqtyBalanceAfter, lqtyBalanceBefore)

    // LQTY staking (check stake has increased as expected within 0.1 error)
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedLQTYGain_A), 10**17)

    // Expect Alice has withdrawn all ETH gain
    const alice_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0] // [[assets], [amounts]]
    assert.equal(alice_pendingETHGain, 0)
  })


  // --- claimStakingGainsAndRecycle ---

  it('claimStakingGainsAndRecycle(): only owner can call it', async () => {
    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })

    // mint some LQTY
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

    // stake LQTY
    await oathToken.approve(lqtyStaking.address, dec(1850, 18), { from: whale });
    await lqtyStaking.stake(dec(1850, 18), { from: whale })
    await oathToken.approve(lqtyStaking.address, dec(150, 18), { from: alice });
    await lqtyStaking.stake(dec(150, 18), { from: alice })

    // Defaulter Trove opened
    const { lusdAmount, netDebt, totalDebt, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 LUSD
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, collaterals[0].address, contracts, redeemedAmount, GAS_PRICE)

    // Bob tries to claims staking gains in behalf of Alice
    const proxy = borrowerWrappers.getProxyFromUser(alice)
    const signature = 'claimStakingGainsAndRecycle(address,uint256,address,address)'
    const calldata = th.getTransactionData(signature, [collaterals[0].address, th._100pct, alice, alice])
    await assertRevert(proxy.methods["execute(address,bytes)"](borrowerWrappers.scriptAddress, calldata, { from: bob }), 'ds-auth-unauthorized')
  })

  it('claimStakingGainsAndRecycle(): reverts if user has no trove', async () => {
    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1950, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })
    // Whale deposits 1850 LUSD in StabilityPool
    await stabilityPool.provideToSP(dec(1850, 18), { from: whale })

    // alice opens trove and provides 150 LUSD to StabilityPool
    await openTrove({ collateral: collaterals[1], extraLUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), { from: alice })

    // mint some LQTY
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

    // stake LQTY
    await oathToken.approve(lqtyStaking.address, dec(1850, 18), { from: whale });
    await lqtyStaking.stake(dec(1850, 18), { from: whale })
    await oathToken.approve(lqtyStaking.address, dec(150, 18), { from: alice });
    await lqtyStaking.stake(dec(150, 18), { from: alice })

    // Defaulter Trove opened
    const { lusdAmount, netDebt, totalDebt, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(lusdAmount)

    // Alice LUSD gain is ((150/2000) * borrowingFee)
    const expectedLUSDGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 LUSD
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, collaterals[0].address, contracts, redeemedAmount, GAS_PRICE)

    const collBalanceBefore = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceBefore = await lusdToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceBefore = await oathToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositBefore = await stabilityPool.deposits(alice)
    const stakeBefore = await lqtyStaking.stakes(alice)

    // Alice claims staking rewards and puts them back in the system through the proxy
    await assertRevert(
      borrowerWrappers.claimStakingGainsAndRecycle(collaterals[0].address, th._100pct, alice, alice, { from: alice }),
      'BorrowerWrappersScript: caller must have an active trove'
    )

    const collBalanceAfter = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceAfter = await lusdToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceAfter = await oathToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositAfter = await stabilityPool.deposits(alice)
    const stakeAfter = await lqtyStaking.stakes(alice)

    // check everything remains the same
    assert.equal(collBalanceAfter.toString(), collBalanceBefore.toString())
    assert.equal(lusdBalanceAfter.toString(), lusdBalanceBefore.toString())
    assert.equal(lqtyBalanceAfter.toString(), lqtyBalanceBefore.toString())
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore, 10000)
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore)
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    th.assertIsApproximatelyEqual(depositAfter, depositBefore, 10000)
    th.assertIsApproximatelyEqual(lqtyBalanceBefore, lqtyBalanceAfter)
    // LQTY staking
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore)

    // Expect Alice has withdrawn all ETH gain
    const alice_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0] // [[assets], [amounts]]
    assert.equal(alice_pendingETHGain, 0)
  })

  it('claimStakingGainsAndRecycle(): with only collateral gain', async () => {
    await stakingToken.mint(owner, toBN(dec(14000, 18)));
    await stakingToken.approve(communityIssuance.address, toBN(dec(14000, 18)), {from: owner});
    await communityIssuance.fund(toBN(dec(14000, 18)), {from: owner});

    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // Defaulter Trove opened
    const { lusdAmount, netDebt, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(lusdAmount)

    // alice opens trove and provides 150 LUSD to StabilityPool
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), { from: alice })

    // mint some LQTY
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

    // stake LQTY
    await oathToken.approve(lqtyStaking.address, dec(1850, 18), { from: whale });
    await lqtyStaking.stake(dec(1850, 18), { from: whale })
    await oathToken.approve(lqtyStaking.address, dec(150, 18), { from: alice });
    await lqtyStaking.stake(dec(150, 18), { from: alice })

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 LUSD
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, collaterals[0].address, contracts, redeemedAmount, GAS_PRICE)

    // Alice ETH gain is ((150/2000) * (redemption fee over redeemedAmount) / price)
    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const redemptionFee = await troveManager.getRedemptionFeeWithDecay(redeemedAmount)
    const expectedETHGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(toBN(10).pow(collDecimals)).div(price)

    const collBalanceBefore = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceBefore = await lusdToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceBefore = await oathToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositBefore = await stabilityPool.deposits(alice)
    const stakeBefore = await lqtyStaking.stakes(alice)

    let scaledETHGain_A = expectedETHGain_A;
    if (collDecimals.gt(toBN(18))) {
      scaledETHGain_A = scaledETHGain_A.div(toBN(10).pow(collDecimals.sub(toBN(18))))
    } else if (collDecimals.lt(toBN(18))) {
      scaledETHGain_A = scaledETHGain_A.mul(toBN(10).pow(toBN(18).sub(collDecimals)))
    }
    const proportionalLUSD = scaledETHGain_A.mul(price).div(ICRBefore)
    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay()
    const netDebtChange = proportionalLUSD.mul(toBN(dec(1, 18))).div(toBN(dec(1, 18)).add(borrowingRate))

    const expectedLQTYGain_A = toBN(dec(14000, 18))

    const proxyAddress = borrowerWrappers.getProxyAddressFromUser(alice)
    // Alice claims staking rewards and puts them back in the system through the proxy
    await borrowerWrappers.claimStakingGainsAndRecycle(collaterals[0].address, th._100pct, alice, alice, { from: alice })

    // Alice new LUSD gain due to her own Trove adjustment: ((150/2000) * (borrowing fee over netDebtChange))
    const newBorrowingFee = await troveManagerOriginal.getBorrowingFeeWithDecay(netDebtChange)
    const expectedNewLUSDGain_A = newBorrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    const collBalanceAfter = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceAfter = await lusdToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceAfter = await oathToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositAfter = await stabilityPool.deposits(alice)
    const stakeAfter = await lqtyStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(collBalanceAfter.toString(), collBalanceBefore.toString())
    assert.equal(lqtyBalanceAfter.toString(), lqtyBalanceBefore.toString())
    // check proxy lusd balance has increased by own adjust trove reward
    th.assertIsApproximatelyEqual(lusdBalanceAfter, lusdBalanceBefore.add(expectedNewLUSDGain_A), 10**16)
    // check trove has increased debt by the ICR proportional amount to ETH gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore.add(proportionalLUSD), 10**10)
    // check trove has increased collateral by the ETH gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore.add(expectedETHGain_A))
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(netDebtChange), 10**10)
    // check lqty balance remains the same
    th.assertIsApproximatelyEqual(lqtyBalanceBefore, lqtyBalanceAfter)

    // LQTY staking (within ~1 error)
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedLQTYGain_A), 10**18)

    // Expect Alice has withdrawn all ETH gain
    const alice_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0] // [[assets], [amounts]]
    assert.equal(alice_pendingETHGain, 0)
  })

  it('claimStakingGainsAndRecycle(): with only LUSD gain', async () => {
    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens trove and provides 150 LUSD to StabilityPool
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), { from: alice })

    // mint some LQTY
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

    // stake LQTY
    await oathToken.approve(lqtyStaking.address, dec(1850, 18), { from: whale });
    await lqtyStaking.stake(dec(1850, 18), { from: whale })
    await oathToken.approve(lqtyStaking.address, dec(150, 18), { from: alice });
    await lqtyStaking.stake(dec(150, 18), { from: alice })

    // Defaulter Trove opened
    const { lusdAmount, netDebt, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(lusdAmount)

    // Alice LUSD gain is ((150/2000) * borrowingFee)
    const expectedLUSDGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    const collBalanceBefore = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceBefore = await lusdToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceBefore = await oathToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositBefore = await stabilityPool.deposits(alice)
    const stakeBefore = await lqtyStaking.stakes(alice)

    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay()

    // Alice claims staking rewards and puts them back in the system through the proxy
    await borrowerWrappers.claimStakingGainsAndRecycle(collaterals[0].address, th._100pct, alice, alice, { from: alice })

    const collBalanceAfter = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceAfter = await lusdToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceAfter = await oathToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositAfter = await stabilityPool.deposits(alice)
    const stakeAfter = await lqtyStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(collBalanceAfter.toString(), collBalanceBefore.toString())
    assert.equal(lqtyBalanceAfter.toString(), lqtyBalanceBefore.toString())
    // check proxy lusd balance has increased by own adjust trove reward
    th.assertIsApproximatelyEqual(lusdBalanceAfter, lusdBalanceBefore)
    // check trove has increased debt by the ICR proportional amount to ETH gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore, 10000)
    // check trove has increased collateral by the ETH gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore)
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(expectedLUSDGain_A), 10000)
    // check lqty balance remains the same
    th.assertIsApproximatelyEqual(lqtyBalanceBefore, lqtyBalanceAfter)

    // Expect Alice has withdrawn all ETH gain
    const alice_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0] // [[assets], [amounts]]
    assert.equal(alice_pendingETHGain, 0)
  })

  it('claimStakingGainsAndRecycle(): with both ETH and LUSD gains', async () => {
    await stakingToken.mint(owner, toBN(dec(14000, 18)));
    await stakingToken.approve(communityIssuance.address, toBN(dec(14000, 18)), {from: owner});
    await communityIssuance.fund(toBN(dec(14000, 18)), {from: owner});

    const price = toBN(dec(200, 18))

    // Whale opens Trove
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(1850, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })

    // alice opens trove and provides 150 LUSD to StabilityPool
    await openTrove({ collateral: collaterals[0], extraLUSDAmount: toBN(dec(150, 18)), extraParams: { from: alice } })
    await stabilityPool.provideToSP(dec(150, 18), { from: alice })

    // mint some LQTY
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(whale), dec(1850, 18))
    await stakingToken.mint(borrowerOperations.getProxyAddressFromUser(alice), dec(150, 18))

    // stake LQTY
    await oathToken.approve(lqtyStaking.address, dec(1850, 18), { from: whale });
    await lqtyStaking.stake(dec(1850, 18), { from: whale })
    await oathToken.approve(lqtyStaking.address, dec(150, 18), { from: alice });
    await lqtyStaking.stake(dec(150, 18), { from: alice })

    // Defaulter Trove opened
    const { lusdAmount, netDebt, collateral } = await openTrove({ collateral: collaterals[0], ICR: toBN(dec(210, 16)), extraParams: { from: defaulter_1 } })
    const borrowingFee = netDebt.sub(lusdAmount)

    // Alice LUSD gain is ((150/2000) * borrowingFee)
    const expectedLUSDGain_A = borrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    // skip bootstrapping phase
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

    // whale redeems 100 LUSD
    const redeemedAmount = toBN(dec(100, 18))
    await th.redeemCollateral(whale, collaterals[0].address, contracts, redeemedAmount, GAS_PRICE)

    // Alice ETH gain is ((150/2000) * (redemption fee over redeemedAmount) / price)
    const collDecimals = await contracts.collateralConfig.getCollateralDecimals(collaterals[0].address)
    const redemptionFee = await troveManager.getRedemptionFeeWithDecay(redeemedAmount)
    const scaledETHGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(mv._1e18BN).div(price)
    const expectedETHGain_A = redemptionFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18))).mul(toBN(10).pow(collDecimals)).div(price)

    const collBalanceBefore = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollBefore = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceBefore = await lusdToken.balanceOf(alice)
    const troveDebtBefore = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceBefore = await oathToken.balanceOf(alice)
    const ICRBefore = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositBefore = await stabilityPool.deposits(alice)
    const stakeBefore = await lqtyStaking.stakes(alice)

    const proportionalLUSD = scaledETHGain_A.mul(price).div(ICRBefore)
    const borrowingRate = await troveManagerOriginal.getBorrowingRateWithDecay()
    const netDebtChange = proportionalLUSD.mul(toBN(dec(1, 18))).div(toBN(dec(1, 18)).add(borrowingRate))
    const expectedTotalLUSD = expectedLUSDGain_A.add(netDebtChange)

    const expectedLQTYGain_A = toBN(dec(14000, 18))

    // Alice claims staking rewards and puts them back in the system through the proxy
    await borrowerWrappers.claimStakingGainsAndRecycle(collaterals[0].address, th._100pct, alice, alice, { from: alice })

    // Alice new LUSD gain due to her own Trove adjustment: ((150/2000) * (borrowing fee over netDebtChange))
    const newBorrowingFee = await troveManagerOriginal.getBorrowingFeeWithDecay(netDebtChange)
    const expectedNewLUSDGain_A = newBorrowingFee.mul(toBN(dec(150, 18))).div(toBN(dec(2000, 18)))

    const collBalanceAfter = await collaterals[0].balanceOf(borrowerOperations.getProxyAddressFromUser(alice))
    const troveCollAfter = await troveManager.getTroveColl(alice, collaterals[0].address)
    const lusdBalanceAfter = await lusdToken.balanceOf(alice)
    const troveDebtAfter = await troveManager.getTroveDebt(alice, collaterals[0].address)
    const lqtyBalanceAfter = await oathToken.balanceOf(alice)
    const ICRAfter = await troveManager.getCurrentICR(alice, collaterals[0].address, price)
    const depositAfter = await stabilityPool.deposits(alice)
    const stakeAfter = await lqtyStaking.stakes(alice)

    // check proxy balances remain the same
    assert.equal(collBalanceAfter.toString(), collBalanceBefore.toString())
    assert.equal(lqtyBalanceAfter.toString(), lqtyBalanceBefore.toString())
    // check proxy lusd balance has increased by own adjust trove reward
    th.assertIsApproximatelyEqual(lusdBalanceAfter, lusdBalanceBefore.add(expectedNewLUSDGain_A), 10**16)
    // check trove has increased debt by the ICR proportional amount to ETH gain
    th.assertIsApproximatelyEqual(troveDebtAfter, troveDebtBefore.add(proportionalLUSD), 10**10)
    // check trove has increased collateral by the ETH gain
    th.assertIsApproximatelyEqual(troveCollAfter, troveCollBefore.add(expectedETHGain_A))
    // check that ICR remains constant
    th.assertIsApproximatelyEqual(ICRAfter, ICRBefore)
    // check that Stability Pool deposit
    th.assertIsApproximatelyEqual(depositAfter, depositBefore.add(expectedTotalLUSD), 10**10)
    // check lqty balance remains the same
    th.assertIsApproximatelyEqual(lqtyBalanceBefore, lqtyBalanceAfter)

    // LQTY staking
    th.assertIsApproximatelyEqual(stakeAfter, stakeBefore.add(expectedLQTYGain_A), 10**17)

    // Expect Alice has withdrawn all ETH gain
    const alice_pendingETHGain = (await stabilityPool.getDepositorCollateralGain(alice))[1][0] // [[assets], [amounts]]
    assert.equal(alice_pendingETHGain, 0)
  })

})
