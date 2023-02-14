const deploymentHelper = require("../utils/deploymentHelpers.js")

const MultiTroveGetter = artifacts.require("./MultiTroveGetter.sol")

async function main() {
  // deploy core contracts and log addresses
  let coreContracts = await deploymentHelper.deployLiquityCoreHardhat()
  console.log({
    collateralConfig: coreContracts.collateralConfig.address,
    priceFeedTestnet: coreContracts.priceFeedTestnet.address,
    lusdToken: coreContracts.lusdToken.address,
    sortedTroves: coreContracts.sortedTroves.address,
    troveManager: coreContracts.troveManager.address,
    redemptionHelper: coreContracts.redemptionHelper.address,
    activePool: coreContracts.activePool.address,
    stabilityPool: coreContracts.stabilityPool.address,
    gasPool: coreContracts.gasPool.address,
    defaultPool: coreContracts.defaultPool.address,
    collSurplusPool: coreContracts.collSurplusPool.address,
    functionCaller: coreContracts.functionCaller.address,
    borrowerOperations: coreContracts.borrowerOperations.address,
    hintHelpers: coreContracts.hintHelpers.address,
    governance: coreContracts.governance.address,
    guardian: coreContracts.guardian.address
  })

  // tack on treasury, collateral, and vault addresses
  coreContracts = await deploymentHelper.deployTestCollaterals(coreContracts)
  console.log({
    collateral1: coreContracts.collaterals[0].address,
    collateral2: coreContracts.collaterals[1].address,
    vault1: coreContracts.erc4626vaults[0].address,
    vault2: coreContracts.erc4626vaults[1].address
  })

  // deploy LQTY-related contracts and log addresses
  let lqtyContracts = await deploymentHelper.deployLQTYContractsHardhat(
    coreContracts.governance.address,
    coreContracts.governance.address,
    coreContracts.governance.address
  )
  console.log({
    lqtyStaking: lqtyContracts.lqtyStaking.address,
    lockupContractFactory: lqtyContracts.lockupContractFactory.address,
    communityIssuance: lqtyContracts.communityIssuance.address,
    lqtyToken: lqtyContracts.lqtyToken.address
  })

  // connect contracts with each other
  await deploymentHelper.connectLQTYContracts(lqtyContracts)
  await deploymentHelper.connectCoreContracts(coreContracts, lqtyContracts)
  await deploymentHelper.connectLQTYContractsToCore(lqtyContracts, coreContracts)

  // deploy MultiTroveGetter
  const multiTroveGetter = await MultiTroveGetter.new(
    coreContracts.collateralConfig.address,
    coreContracts.troveManager.address,
    coreContracts.sortedTroves.address
  )
  MultiTroveGetter.setAsDeployed(multiTroveGetter)
  console.log({
    multiTroveGetter: multiTroveGetter.address
  })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });