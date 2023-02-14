const deploymentHelper = require("../utils/deploymentHelpers.js")

contract('Deployment script - Sets correct contract addresses dependencies after deployment', async accounts => {
  const [owner] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let functionCaller
  let borrowerOperations
  let lqtyStaking
  let stakingToken
  let oathToken
  let communityIssuance
  let lockupContractFactory
  let collaterals
  let collateralConfig
  let redemptionHelper

  before(async () => {
    const coreContracts = await deploymentHelper.deployTestCollaterals(await deploymentHelper.deployLiquityCore())
    const LQTYContracts = await deploymentHelper.deployLQTYContracts(multisig)

    priceFeed = coreContracts.priceFeedTestnet
    lusdToken = coreContracts.lusdToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    activePool = coreContracts.activePool
    stabilityPool = coreContracts.stabilityPool
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations
    collaterals = coreContracts.collaterals
    collateralConfig = coreContracts.collateralConfig
    redemptionHelper = coreContracts.redemptionHelper

    lqtyStaking = LQTYContracts.lqtyStaking
    stakingToken = LQTYContracts.stakingToken
    communityIssuance = LQTYContracts.communityIssuance
    oathToken = LQTYContracts.oathToken

    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(coreContracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, coreContracts)
  })

  it('Sets the correct PriceFeed address in TroveManager', async () => {
    const priceFeedAddress = priceFeed.address

    const recordedPriceFeedAddress = await troveManager.priceFeed()

    assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  })

  it('Sets the correct LUSDToken address in TroveManager', async () => {
    const lusdTokenAddress = lusdToken.address

    const recordedClvTokenAddress = await troveManager.lusdToken()

    assert.equal(lusdTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct SortedTroves address in TroveManager', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await troveManager.sortedTroves()

    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  it('Sets the correct BorrowerOperations address in TroveManager', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await troveManager.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ActivePool in TroveM
  it('Sets the correct ActivePool address in TroveManager', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddresss = await troveManager.activePool()

    assert.equal(activePoolAddress, recordedActivePoolAddresss)
  })

  // DefaultPool in TroveM
  it('Sets the correct DefaultPool address in TroveManager', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddresss = await troveManager.defaultPool()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddresss)
  })

  // StabilityPool in TroveM
  it('Sets the correct StabilityPool address in TroveManager', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddresss = await troveManager.stabilityPool()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddresss)
  })

  // LQTY Staking in TroveM
  it('Sets the correct LQTYStaking address in TroveManager', async () => {
    const lqtyStakingAddress = lqtyStaking.address

    const recordedLQTYStakingAddress = await troveManager.lqtyStaking()
    assert.equal(lqtyStakingAddress, recordedLQTYStakingAddress)
  })

  // Collateral Config in TroveM
  it('Sets the correct CollateralConfig address in TroveManager', async () => {
    const collateralConfigAddress = collateralConfig.address

    const recordedCollateralConfigAddress = await troveManager.collateralConfig()
    assert.equal(collateralConfigAddress, recordedCollateralConfigAddress)
  })

  // Redemption Helper in TroveM
  it('Sets the correct RedemptionHelper address in TroveManager', async () => {
    const redemptionHelperAddress = redemptionHelper.address

    const recordedRedemptionHelperAddress = await troveManager.redemptionHelper()
    assert.equal(redemptionHelperAddress, recordedRedemptionHelperAddress)
  })

  // Active Pool

  it('Sets the correct StabilityPool address in ActivePool', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await activePool.stabilityPoolAddress()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })

  it('Sets the correct DefaultPool address in ActivePool', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await activePool.defaultPoolAddress()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  it('Sets the correct BorrowerOperations address in ActivePool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await activePool.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct TroveManager address in ActivePool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await activePool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct CollateralConfig address in ActivePool', async () => {
    const collateralConfigAddress = collateralConfig.address

    const recordedCollateralConfigAddress = await activePool.collateralConfigAddress()
    assert.equal(collateralConfigAddress, recordedCollateralConfigAddress)
  })

  // Stability Pool

  it('Sets the correct ActivePool address in StabilityPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await stabilityPool.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct BorrowerOperations address in StabilityPool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await stabilityPool.borrowerOperations()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct LUSDToken address in StabilityPool', async () => {
    const lusdTokenAddress = lusdToken.address

    const recordedClvTokenAddress = await stabilityPool.lusdToken()

    assert.equal(lusdTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct TroveManager address in StabilityPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await stabilityPool.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct CollateralConfig address in StabilityPool', async () => {
    const collateralConfigAddress = collateralConfig.address

    const recordedCollateralConfigAddress = await stabilityPool.collateralConfig()
    assert.equal(collateralConfigAddress, recordedCollateralConfigAddress)
  })

  // Default Pool

  it('Sets the correct TroveManager address in DefaultPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await defaultPool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct ActivePool address in DefaultPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await defaultPool.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct CollateralConfig address in DefaultPool', async () => {
    const collateralConfigAddress = collateralConfig.address

    const recordedCollateralConfigAddress = await defaultPool.collateralConfigAddress()
    assert.equal(collateralConfigAddress, recordedCollateralConfigAddress)
  })

  it('Sets the correct TroveManager address in SortedTroves', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await sortedTroves.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct BorrowerOperations address in SortedTroves', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await sortedTroves.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  //--- BorrowerOperations ---

  // TroveManager in BO
  it('Sets the correct TroveManager address in BorrowerOperations', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await borrowerOperations.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // setPriceFeed in BO
  it('Sets the correct PriceFeed address in BorrowerOperations', async () => {
    const priceFeedAddress = priceFeed.address

    const recordedPriceFeedAddress = await borrowerOperations.priceFeed()
    assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  })

  // setSortedTroves in BO
  it('Sets the correct SortedTroves address in BorrowerOperations', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await borrowerOperations.sortedTroves()
    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  // setActivePool in BO
  it('Sets the correct ActivePool address in BorrowerOperations', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await borrowerOperations.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // setDefaultPool in BO
  it('Sets the correct DefaultPool address in BorrowerOperations', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await borrowerOperations.defaultPool()
    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  // LQTY Staking in BO
  it('Sets the correct LQTYStaking address in BorrowerOperations', async () => {
    const lqtyStakingAddress = lqtyStaking.address

    const recordedLQTYStakingAddress = await borrowerOperations.lqtyStakingAddress()
    assert.equal(lqtyStakingAddress, recordedLQTYStakingAddress)
  })

  // Collateral Config in BO
  it('Sets the correct CollateralConfig address in BorrowerOperations', async () => {
    const collateralConfigAddress = collateralConfig.address

    const recordedCollateralConfigAddress = await borrowerOperations.collateralConfig()
    assert.equal(collateralConfigAddress, recordedCollateralConfigAddress)
  })


  // --- LQTY Staking ---

  // Sets StakingToken in LQTYStaking
  it('Sets the correct LQTYToken address in LQTYStaking', async () => {
    const lqtyTokenAddress = stakingToken.address

    const recordedLQTYTokenAddress = await lqtyStaking.lqtyToken()
    assert.equal(lqtyTokenAddress, recordedLQTYTokenAddress)
  })

  // Sets ActivePool in LQTYStaking
  it('Sets the correct ActivePool address in LQTYStaking', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await lqtyStaking.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // Sets LUSDToken in LQTYStaking
  it('Sets the correct ActivePool address in LQTYStaking', async () => {
    const lusdTokenAddress = lusdToken.address

    const recordedLUSDTokenAddress = await lqtyStaking.lusdToken()
    assert.equal(lusdTokenAddress, recordedLUSDTokenAddress)
  })

  // Sets TroveManager in LQTYStaking
  it('Sets the correct ActivePool address in LQTYStaking', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await lqtyStaking.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Sets BorrowerOperations in LQTYStaking
  it('Sets the correct BorrowerOperations address in LQTYStaking', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await lqtyStaking.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // Sets CollateralConfig in LQTYStaking
  it('Sets the correct CollateralConfig address in LQTYStaking', async () => {
    const collateralConfigAddress = collateralConfig.address

    const recordedCollateralConfigAddress = await lqtyStaking.collateralConfig()
    assert.equal(collateralConfigAddress, recordedCollateralConfigAddress)
  })

  // --- CI ---

  // Sets OATHToken in CommunityIssuance
  it('Sets the correct LQTYToken address in CommunityIssuance', async () => {
    const oathTokenAddress = oathToken.address

    const recordedOATHTokenAddress = await communityIssuance.OathToken()
    assert.equal(oathTokenAddress, recordedOATHTokenAddress)
  })

  it('Sets the correct StabilityPool address in CommunityIssuance', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await communityIssuance.stabilityPoolAddress()
    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })
})
