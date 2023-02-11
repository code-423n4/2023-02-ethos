const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("TroveManagerTester")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues

const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert

/* The majority of access control tests are contained in this file. However, tests for restrictions 
on the Liquity admin address's capabilities during the first year are found in:

test/launchSequenceTest/DuringLockupPeriodTest.js */

contract('Access Control: Liquity functions with the caller restricted to Liquity contract(s)', async accounts => {

  const [owner, alice, bob, carol, multisig] = accounts;

  let coreContracts

  let collateralConfig
  let priceFeed
  let lusdToken
  let sortedTroves
  let troveManager
  let redemptionHelper
  let nameRegistry
  let activePool
  let stabilityPool
  let defaultPool
  let functionCaller
  let borrowerOperations
  let collaterals
  let governance
  let guardian

  let lqtyStaking
  let stakingToken
  let oathToken
  let communityIssuance

  before(async () => {
    coreContracts = await deploymentHelper.deployLiquityCore()
    coreContracts.troveManager = await TroveManagerTester.new()
    coreContracts = await deploymentHelper.deployLUSDTokenTester(coreContracts)
    coreContracts = await deploymentHelper.deployTestCollaterals(coreContracts)
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(multisig)
    
    collateralConfig = coreContracts.collateralConfig
    priceFeed = coreContracts.priceFeedTestnet
    lusdToken = coreContracts.lusdToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    redemptionHelper = coreContracts.redemptionHelper
    nameRegistry = coreContracts.nameRegistry
    activePool = coreContracts.activePool
    stabilityPool = coreContracts.stabilityPool
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations
    collaterals = coreContracts.collaterals
    governance = coreContracts.governance
    guardian = coreContracts.guardian

    lqtyStaking = LQTYContracts.lqtyStaking
    stakingToken = LQTYContracts.stakingToken
    oathToken = LQTYContracts.oathToken
    communityIssuance = LQTYContracts.communityIssuance

    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(coreContracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, coreContracts)

    for (account of accounts.slice(0, 10)) {
      await th.openTrove(coreContracts, { collateral: collaterals[0], extraLUSDAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: account } })
    }
  })

  describe('TroveManager', async accounts => {
    // applyPendingRewards
    it("applyPendingRewards(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.applyPendingRewards(bob, collaterals[0].address, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // updateRewardSnapshots
    it("updateRewardSnapshots(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.updateTroveRewardSnapshots(bob, collaterals[0].address, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert" )
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // removeStake
    it("removeStake(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.removeStake(bob, collaterals[0].address, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // updateStakeAndTotalStakes
    it("updateStakeAndTotalStakes(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.updateStakeAndTotalStakes(bob, collaterals[0].address, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // closeTrove
    it("closeTrove(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.closeTrove(bob, collaterals[0].address, 2, { from: alice }) // 2 = closeByOwner
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // addTroveOwnerToArray
    it("addTroveOwnerToArray(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.addTroveOwnerToArray(bob, collaterals[0].address, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // setTroveStatus
    it("setTroveStatus(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.setTroveStatus(bob, collaterals[0].address, 1, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // increaseTroveColl
    it("increaseTroveColl(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.increaseTroveColl(bob, collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // decreaseTroveColl
    it("decreaseTroveColl(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.decreaseTroveColl(bob, collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // increaseTroveDebt
    it("increaseTroveDebt(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.increaseTroveDebt(bob, collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })

    // decreaseTroveDebt
    it("decreaseTroveDebt(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      try {
        const txAlice = await troveManager.decreaseTroveDebt(bob, collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
         assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is not the BorrowerOperations contract")
      }
    })
  })

  describe('CollateralConfig', async accounts => {
    it("updateCollateralRatios(): reverts when called by an account that is not Owner", async () => {
      const txGuardian = collateralConfig.updateCollateralRatios(
        collaterals[0].address,
        toBN(dec(110, 16)),
        toBN(dec(150, 16)),
        { from : alice }
      )
      await assertRevert(txGuardian, "Ownable: caller is not owner");
    });
  });

  describe('RedemptionHelper', async accounts => {
    it("redeemCollateral(): reverts when called by an account that it not TroveManager", async () => {
      const price = await priceFeed.getPrice(collaterals[0].address);
      const redemptionhint = await coreContracts.hintHelpers.getRedemptionHints(
        collaterals[0].address,
        toBN(dec(50, 18)),
        price,
        0 // gas price
      )

      const firstRedemptionHint = redemptionhint[0]
      const partialRedemptionNewICR = redemptionhint[1]

      const {
        hintAddress: approxPartialRedemptionHint,
        latestRandomSeed
      } = await coreContracts.hintHelpers.getApproxHint(
        collaterals[0].address,
        partialRedemptionNewICR,
        50,
        100 // random seed
      )

      const exactPartialRedemptionHint = await coreContracts.sortedTroves.findInsertPosition(
        collaterals[0].address,
        partialRedemptionNewICR,
        approxPartialRedemptionHint,
        approxPartialRedemptionHint
      )

      // skip bootstrapping phase
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_WEEK * 2, web3.currentProvider)

      const txAlice = redemptionHelper.redeemCollateral(
        collaterals[0].address,
        alice,
        toBN(dec(50, 18)),
        firstRedemptionHint,
        exactPartialRedemptionHint[0],
        exactPartialRedemptionHint[1],
        partialRedemptionNewICR,
        0, // max iterations
        th._100pct // max fee
      )

      await th.assertRevert(txAlice, "RedemptionHelper: Caller is not TroveManager");
    });
  });

  describe('ActivePool', async accounts => {
    // sendCollateral
    it("sendCollateral(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.sendCollateral(collaterals[0].address, alice, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // increaseLUSD	
    it("increaseLUSDDebt(): reverts when called by an account that is not BO nor TroveM", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.increaseLUSDDebt(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager")
      }
    })

    // decreaseLUSD
    it("decreaseLUSDDebt(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.decreaseLUSDDebt(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // pullCollateral (payment)	
    it("pullCollateral(): reverts when called by an account that is not Borrower Operations nor Default Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await activePool.pullCollateralFromBorrowerOperationsOrDefaultPool(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "ActivePool: Caller is neither BO nor Default Pool")
      }
    })
  })

  describe('DefaultPool', async accounts => {
    // sendCollateralToActivePool
    it("sendCollateralToActivePool(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.sendCollateralToActivePool(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the TroveManager")
      }
    })

    // increaseLUSD	
    it("increaseLUSDDebt(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.increaseLUSDDebt(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the TroveManager")
      }
    })

    // decreaseLUSD	
    it("decreaseLUSD(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.decreaseLUSDDebt(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the TroveManager")
      }
    })

    // pullCollateral (payment)	
    it("pullCollateral(): reverts when called by an account that is not the Active Pool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await defaultPool.pullCollateralFromActivePool(collaterals[0].address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "DefaultPool: Caller is not the ActivePool")
      }
    })
  })

  describe('StabilityPool', async accounts => {
    // --- onlyTroveManager --- 

    // offset
    it("offset(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        txAlice = await stabilityPool.offset(collaterals[0].address, 100, 10, { from: alice })
        assert.fail(txAlice)
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not TroveManager")
      }
    })
  })

  describe('LUSDToken', async accounts => {

    //    mint
    it("mint(): reverts when called by an account that is not BorrowerOperations", async () => {
      // Attempt call from alice
      const txAlice = lusdToken.mint(bob, 100, { from: alice })
      await th.assertRevert(txAlice, "Caller is not BorrowerOperations")
    })

    // burn
    it("burn(): reverts when called by an account that is not BO nor TroveM nor SP", async () => {
      // Attempt call from alice
      try {
        const txAlice = await lusdToken.burn(bob, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is neither BorrowerOperations nor TroveManager nor StabilityPool")
      }
    })

    // sendToPool
    it("sendToPool(): reverts when called by an account that is not StabilityPool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await lusdToken.sendToPool(bob, activePool.address, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is not the StabilityPool")
      }
    })

    // returnFromPool
    it("returnFromPool(): reverts when called by an account that is not TroveManager nor StabilityPool", async () => {
      // Attempt call from alice
      try {
        const txAlice = await lusdToken.returnFromPool(activePool.address, bob, 100, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        // assert.include(err.message, "Caller is neither TroveManager nor StabilityPool")
      }
    })

    // pause
    it("pauseMinting(): reverts when called by an account that is not Governance or Guardian", async () => {
      const txAlice = lusdToken.pauseMinting({from: alice});
      th.assertRevert(txAlice, "LUSD: Caller is not guardian or governance");
    });

    // unpause
    it("unpauseMinting(): reverts when called by an account that is not Governance", async () => {
      const txAlice = lusdToken.unpauseMinting({from: alice});
      th.assertRevert(txAlice, "LUSD: Caller is not governance");
    });

    // upgrade protocol
    it("upgradeProtocol(): reverts when called by an account that is not Governance", async () => {
      const newContracts = await deploymentHelper.deployLiquityCore();
      newContracts.lusdToken = lusdToken;
      newContracts.treasury = coreContracts.treasury;
      newContracts.collaterals = coreContracts.collaterals;
      newContracts.erc4626vaults = coreContracts.erc4626vaults;
      const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(multisig)
      await deploymentHelper.connectLQTYContracts(LQTYContracts)
      await deploymentHelper.connectCoreContracts(newContracts, LQTYContracts)
      await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, newContracts)
      const txAlice = lusdToken.upgradeProtocol(
        newContracts.troveManager.address,
        newContracts.stabilityPool.address,
        newContracts.borrowerOperations.address
      )
      th.assertRevert(txAlice, "LUSD: Caller is not governance");
    });

    // update governance
    it("updateGovernance: reverts when called by an account that is not Governance", async () => {
      const txAlice = lusdToken.updateGovernance(alice, {from: alice});
      th.assertRevert(txAlice, "LUSD: Caller is not governance");
    })

    // update guardian
    it("updateGuardian: reverts when called by an account that is not Governance", async () => {
      const txAlice = lusdToken.updateGuardian(alice, {from: alice});
      th.assertRevert(txAlice, "LUSD: Caller is not governance");
    })
  })

  describe('SortedTroves', async accounts => {
    // --- onlyBorrowerOperations ---
    //     insert
    it("insert(): reverts when called by an account that is not BorrowerOps or TroveM", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.insert(collaterals[0].address, bob, '150000000000000000000', bob, bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, " Caller is neither BO nor TroveM")
      }
    })

    // --- onlyTroveManager ---
    // remove
    it("remove(): reverts when called by an account that is not TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.remove(collaterals[0].address, bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, " Caller is not the TroveManager")
      }
    })

    // --- onlyTroveMorBM ---
    // reinsert
    it("reinsert(): reverts when called by an account that is neither BorrowerOps nor TroveManager", async () => {
      // Attempt call from alice
      try {
        const txAlice = await sortedTroves.reInsert(bob, collaterals[0].address, '150000000000000000000', bob, bob, { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
        assert.include(err.message, "Caller is neither BO nor TroveM")
      }
    })
  })

  describe('LQTYStaking', async accounts => {
    it("increaseF_LUSD(): reverts when caller is not TroveManager", async () => {
      try {
        const txAlice = await lqtyStaking.increaseF_LUSD(dec(1, 18), { from: alice })
        
      } catch (err) {
        assert.include(err.message, "revert")
      }
    })
  })

  describe('CommunityIssuance', async accounts => {
    it("sendOath(): reverts when caller is not the StabilityPool", async () => {
      const tx1 = communityIssuance.sendOath(alice, dec(100, 18), {from: alice})
      const tx2 = communityIssuance.sendOath(bob, dec(100, 18), {from: alice})
      const tx3 = communityIssuance.sendOath(stabilityPool.address, dec(100, 18), {from: alice})
     
      assertRevert(tx1)
      assertRevert(tx2)
      assertRevert(tx3)
    })

    it("issueOath(): reverts when caller is not the StabilityPool", async () => {
      const tx1 = communityIssuance.issueOath({from: alice})

      assertRevert(tx1)
    })
  })

  
})


