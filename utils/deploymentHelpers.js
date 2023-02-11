const CollateralConfig = artifacts.require("./CollateralConfig.sol")
const SortedTroves = artifacts.require("./SortedTroves.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const RedemptionHelper = artifacts.require("./RedemptionHelper.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const LUSDToken = artifacts.require("./LUSDToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol");
const DefaultPool = artifacts.require("./DefaultPool.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol")
const GasPool = artifacts.require("./GasPool.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const HintHelpers = artifacts.require("./HintHelpers.sol")

const LQTYStaking = artifacts.require("./LQTYStaking.sol")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")

const ERC20 = artifacts.require("ERC20Mock.sol");
const ERC4626 = artifacts.require("ERC4626.sol");
const Governance = artifacts.require("MockGovernance.sol");
const Guardian = artifacts.require("MockGuardian.sol");

const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol")
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol")
const LiquityMathTester = artifacts.require("./LiquityMathTester.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const LUSDTokenTester = artifacts.require("./LUSDTokenTester.sol")

// Proxy scripts
const BorrowerOperationsScript = artifacts.require('BorrowerOperationsScript')
const BorrowerWrappersScript = artifacts.require('BorrowerWrappersScript')
const TroveManagerScript = artifacts.require('TroveManagerScript')
const StabilityPoolScript = artifacts.require('StabilityPoolScript')
const TokenScript = artifacts.require('TokenScript')
const LQTYStakingScript = artifacts.require('LQTYStakingScript')
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
const testHelpers = require("./testHelpers.js")
const toBN = testHelpers.TestHelper.toBN
const dec = testHelpers.TestHelper.dec

/* "Liquity core" consists of all contracts in the core Liquity system.

LQTY contracts consist of only those contracts related to the LQTY Token:

-the LQTY token
-the Lockup factory and lockup contracts
-the LQTYStaking contract
-the CommunityIssuance contract 
*/

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

class DeploymentHelper {

  static async deployLiquityCore() {
    const cmdLineArgs = process.argv
    const frameworkPath = cmdLineArgs[1]
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployLiquityCoreHardhat()
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLiquityCoreTruffle()
    }
  }

  static async deployLQTYContracts(multisigAddress) {
    const cmdLineArgs = process.argv
    const frameworkPath = cmdLineArgs[1]
    // console.log(`Framework used:  ${frameworkPath}`)

    if (frameworkPath.includes("hardhat")) {
      return this.deployLQTYContractsHardhat(multisigAddress)
    } else if (frameworkPath.includes("truffle")) {
      return this.deployLQTYContractsTruffle(multisigAddress)
    }
  }

  static async deployLiquityCoreHardhat() {
    const collateralConfig = await CollateralConfig.new()
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const redemptionHelper = await RedemptionHelper.new()
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const governance = await Governance.new()
    const guardian = await Guardian.new()
    const lusdToken = await LUSDToken.new(
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address,
      governance.address,
      guardian.address
    )
    CollateralConfig.setAsDeployed(collateralConfig)
    LUSDToken.setAsDeployed(lusdToken)
    DefaultPool.setAsDeployed(defaultPool)
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
    SortedTroves.setAsDeployed(sortedTroves)
    TroveManager.setAsDeployed(troveManager)
    RedemptionHelper.setAsDeployed(redemptionHelper)
    ActivePool.setAsDeployed(activePool)
    StabilityPool.setAsDeployed(stabilityPool)
    GasPool.setAsDeployed(gasPool)
    CollSurplusPool.setAsDeployed(collSurplusPool)
    FunctionCaller.setAsDeployed(functionCaller)
    BorrowerOperations.setAsDeployed(borrowerOperations)
    HintHelpers.setAsDeployed(hintHelpers)
    Governance.setAsDeployed(governance)
    Guardian.setAsDeployed(guardian)

    const coreContracts = {
      collateralConfig,
      priceFeedTestnet,
      lusdToken,
      sortedTroves,
      troveManager,
      redemptionHelper,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers,
      governance,
      guardian
    }
    return coreContracts
  }

  static async deployTesterContractsHardhat() {
    const testerContracts = {}

    // Contract without testers (yet)
    testerContracts.collateralConfig = await CollateralConfig.new()
    testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
    testerContracts.sortedTroves = await SortedTroves.new()
    testerContracts.redemptionHelper = await RedemptionHelper.new()
    // Actual tester contracts
    testerContracts.communityIssuance = await CommunityIssuanceTester.new()
    testerContracts.activePool = await ActivePoolTester.new()
    testerContracts.defaultPool = await DefaultPoolTester.new()
    testerContracts.stabilityPool = await StabilityPoolTester.new()
    testerContracts.gasPool = await GasPool.new()
    testerContracts.collSurplusPool = await CollSurplusPool.new()
    testerContracts.math = await LiquityMathTester.new()
    testerContracts.borrowerOperations = await BorrowerOperationsTester.new()
    testerContracts.troveManager = await TroveManagerTester.new()
    testerContracts.functionCaller = await FunctionCaller.new()
    testerContracts.hintHelpers = await HintHelpers.new()
    testerContracts.governance = await Governance.new()
    testerContracts.guardian = await Guardian.new()
    testerContracts.lusdToken =  await LUSDTokenTester.new(
      testerContracts.troveManager.address,
      testerContracts.stabilityPool.address,
      testerContracts.borrowerOperations.address,
      testerContracts.governance.address,
      testerContracts.guardian.address
    )
    return testerContracts
  }

  static async deployLQTYContractsHardhat(multisigAddress) {
    const lqtyStaking = await LQTYStaking.new()
    const communityIssuance = await CommunityIssuance.new()

    LQTYStaking.setAsDeployed(lqtyStaking)
    CommunityIssuance.setAsDeployed(communityIssuance)

    const stakingToken = await ERC20.new(
      "OATH-ETH BPT",
      "BPT-OATH",
      18,
      multisigAddress,
      toBN(dec(1000, 18))
    )
    ERC20.setAsDeployed(stakingToken)
    const oathToken = await ERC20.new(
      "OATH Token",
      "OATH",
      18,
      multisigAddress,
      toBN(dec(1000, 18))
    )
    ERC20.setAsDeployed(oathToken)

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      stakingToken,
      oathToken
    }
    return LQTYContracts
  }

  static async deployLQTYTesterContractsHardhat(multisigAddress) {
    const lqtyStaking = await LQTYStaking.new()
    const communityIssuance = await CommunityIssuanceTester.new()

    LQTYStaking.setAsDeployed(lqtyStaking)
    CommunityIssuanceTester.setAsDeployed(communityIssuance)

    const stakingToken = await ERC20.new(
      "OATH-ETH BPT",
      "BPT-OATH",
      18,
      multisigAddress,
      toBN(dec(1000, 18))
    )
    ERC20.setAsDeployed(stakingToken)
    const oathToken = await ERC20.new(
      "OATH Token",
      "OATH",
      18,
      multisigAddress,
      toBN(dec(1000, 18))
    )
    ERC20.setAsDeployed(oathToken)

    const LQTYContracts = {
      lqtyStaking,
      communityIssuance,
      stakingToken,
      oathToken
    }
    return LQTYContracts
  }

  static async deployLiquityCoreTruffle() {
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const activePool = await ActivePool.new()
    const stabilityPool = await StabilityPool.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const lusdToken = await LUSDToken.new(
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address
    )
    const coreContracts = {
      priceFeedTestnet,
      lusdToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPool,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers
    }
    return coreContracts
  }

  static async deployLQTYContractsTruffle(bountyAddress, lpRewardsAddress, multisigAddress) {
    const lqtyStaking = await lqtyStaking.new()
    const lockupContractFactory = await LockupContractFactory.new()
    const communityIssuance = await CommunityIssuance.new()

    /* Deploy LQTY Token, passing Community Issuance,  LQTYStaking, and Factory addresses 
    to the constructor  */
    const lqtyToken = await LQTYToken.new(
      communityIssuance.address, 
      lqtyStaking.address,
      lockupContractFactory.address,
      bountyAddress,
      lpRewardsAddress, 
      multisigAddress
    )

    const LQTYContracts = {
      lqtyStaking,
      lockupContractFactory,
      communityIssuance,
      lqtyToken
    }
    return LQTYContracts
  }

  static async deployLUSDToken(contracts) {
    contracts.lusdToken = await LUSDToken.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.governance.address,
      contracts.guardian.address
    )
    return contracts
  }

  static async deployLUSDTokenTester(contracts) {
    contracts.lusdToken = await LUSDTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.borrowerOperations.address,
      contracts.governance.address,
      contracts.guardian.address
    )
    return contracts
  }

  static async deployTestCollaterals(contracts) {
    const multisig = "0x3b410908e71Ee04e7dE2a87f8F9003AFe6c1c7cE"  // Arbitrary address for the multisig, which is not tested in this file
    const collateral1 = await ERC20.new("Wrapped Ether", "wETH", 12, multisig, 0); // 12 decimal places
    const collateral2 = await ERC20.new("Wrapped Bitcoin", "wBTC", 8, multisig, 0); // 8 decimal places
    const vault1 = await ERC4626.new(collateral1.address, "wETH Crypt", "rfwETH");
    const vault2 = await ERC4626.new(collateral2.address, "wBTC Crypt", "rfwBTC");

    contracts.treasury = multisig;
    contracts.collaterals = [collateral1, collateral2];
    contracts.erc4626vaults = [vault1, vault2];
    return contracts
  }

  static async deployProxyScripts(contracts, LQTYContracts, owner, users) {
    const proxies = await buildUserProxies(users)

    const borrowerWrappersScript = await BorrowerWrappersScript.new(
      contracts.borrowerOperations.address,
      contracts.collateralConfig.address,
      contracts.troveManager.address,
      LQTYContracts.lqtyStaking.address
    )
    contracts.borrowerWrappers = new BorrowerWrappersProxy(owner, proxies, borrowerWrappersScript.address)

    const borrowerOperationsScript = await BorrowerOperationsScript.new(contracts.borrowerOperations.address)
    contracts.borrowerOperations = new BorrowerOperationsProxy(owner, proxies, borrowerOperationsScript.address, contracts.borrowerOperations)

    const troveManagerScript = await TroveManagerScript.new(contracts.troveManager.address)
    contracts.troveManager = new TroveManagerProxy(owner, proxies, troveManagerScript.address, contracts.troveManager)

    const stabilityPoolScript = await StabilityPoolScript.new(contracts.stabilityPool.address)
    contracts.stabilityPool = new StabilityPoolProxy(owner, proxies, stabilityPoolScript.address, contracts.stabilityPool)

    contracts.sortedTroves = new SortedTrovesProxy(owner, proxies, contracts.sortedTroves)

    const lusdTokenScript = await TokenScript.new(contracts.lusdToken.address)
    contracts.lusdToken = new TokenProxy(owner, proxies, lusdTokenScript.address, contracts.lusdToken)

    const lqtyTokenScript = await TokenScript.new(LQTYContracts.stakingToken.address)
    LQTYContracts.stakingToken = new TokenProxy(owner, proxies, lqtyTokenScript.address, LQTYContracts.stakingToken)

    const lqtyStakingScript = await LQTYStakingScript.new(LQTYContracts.lqtyStaking.address)
    LQTYContracts.lqtyStaking = new LQTYStakingProxy(owner, proxies, lqtyStakingScript.address, LQTYContracts.lqtyStaking)
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, LQTYContracts) {
    await contracts.collateralConfig.initialize(
      contracts.collaterals.map(c => c.address),
      [toBN(dec(12, 17)), toBN(dec(13, 17))], // MCR for WETH at 120%, and for WBTC at 130%
      [toBN(dec(165, 16)), toBN(dec(18, 17))] // CCR for WETH at 165%, and for WBTC at 180%
    )

    // set TroveManager addr in SortedTroves
    await contracts.sortedTroves.setParams(
      contracts.troveManager.address,
      contracts.borrowerOperations.address
    )

    // set contract addresses in the FunctionCaller 
    await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address)
    await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address)

    // set contracts in the Trove Manager
    await contracts.troveManager.setAddresses(
      contracts.borrowerOperations.address,
      contracts.collateralConfig.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.priceFeedTestnet.address,
      contracts.lusdToken.address,
      contracts.sortedTroves.address,
      LQTYContracts.stakingToken.address,
      LQTYContracts.lqtyStaking.address,
      contracts.redemptionHelper.address
    )

    await contracts.redemptionHelper.setAddresses(
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.troveManager.address,
      contracts.collateralConfig.address,
      LQTYContracts.stakingToken.address,
      contracts.priceFeedTestnet.address,
      contracts.lusdToken.address,
      contracts.sortedTroves.address,
      LQTYContracts.lqtyStaking.address,
    )

    // set contracts in BorrowerOperations 
    await contracts.borrowerOperations.setAddresses(
      contracts.collateralConfig.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.stabilityPool.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.priceFeedTestnet.address,
      contracts.sortedTroves.address,
      contracts.lusdToken.address,
      LQTYContracts.lqtyStaking.address
    )

    // set contracts in the Pools
    await contracts.stabilityPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.collateralConfig.address,
      contracts.troveManager.address,
      contracts.activePool.address,
      contracts.lusdToken.address,
      contracts.sortedTroves.address,
      contracts.priceFeedTestnet.address,
      LQTYContracts.communityIssuance.address
    )

    await contracts.activePool.setAddresses(
      contracts.collateralConfig.address,
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.stabilityPool.address,
      contracts.defaultPool.address,
      contracts.collSurplusPool.address,
      contracts.treasury,
      LQTYContracts.lqtyStaking.address,
      contracts.erc4626vaults.map(v => v.address)
    )

    await contracts.defaultPool.setAddresses(
      contracts.collateralConfig.address,
      contracts.troveManager.address,
      contracts.activePool.address,
    )

    await contracts.collSurplusPool.setAddresses(
      contracts.collateralConfig.address,
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
    )

    // set contracts in HintHelpers
    await contracts.hintHelpers.setAddresses(
      contracts.collateralConfig.address,
      contracts.sortedTroves.address,
      contracts.troveManager.address
    )
  }

  static async connectLQTYContracts(LQTYContracts) {
    // no-op
  }

  static async connectLQTYContractsToCore(LQTYContracts, coreContracts) {
    await LQTYContracts.lqtyStaking.setAddresses(
      LQTYContracts.stakingToken.address,
      coreContracts.lusdToken.address,
      coreContracts.troveManager.address, 
      coreContracts.borrowerOperations.address,
      coreContracts.activePool.address,
      coreContracts.collateralConfig.address
    )
  
    await LQTYContracts.communityIssuance.setAddresses(
      LQTYContracts.oathToken.address,
      coreContracts.stabilityPool.address
    )
  }

  static async connectUnipool(uniPool, LQTYContracts, uniswapPairAddr, duration) {
    await uniPool.setParams(LQTYContracts.lqtyToken.address, uniswapPairAddr, duration)
  }
}
module.exports = DeploymentHelper
