const CollateralConfig = artifacts.require("./CollateralConfig.sol")
const StabilityPool = artifacts.require("./StabilityPool.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const LQTYStaking = artifacts.require("./LQTYStaking.sol")
const ActivePool = artifacts.require("./ActivePool.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const NonPayable = artifacts.require("./NonPayable.sol")
const ERC20 = artifacts.require("ERC20Mock.sol");
const ERC4626 = artifacts.require("ERC4626.sol");

const testHelpers = require("../utils/testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

const _minus_1_Ether = web3.utils.toWei('-1', 'ether')

contract('StabilityPool', async accounts => {
  /* mock* are EOA’s, temporarily used to call protected functions.
  TODO: Replace with mock contracts, and later complete transactions from EOA
  */
  let stabilityPool
  const [owner, alice] = accounts;

  beforeEach(async () => {
    stabilityPool = await StabilityPool.new()
    const dumbContractAddress = (await NonPayable.new()).address
    await stabilityPool.setAddresses(
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress
    )
  })

  it('getCollateral(): gets the recorded collateral balance', async () => {
    const collateral = "0x5b5e5CC89636CA2685b4e4f50E66099EBCFAb638"  // Arbitrary ERC20 address
    const recordedETHBalance = await stabilityPool.getCollateral(collateral)
    assert.equal(recordedETHBalance, 0)
  })

  it('getTotalLUSDDeposits(): gets the recorded LUSD balance', async () => {
    const recordedETHBalance = await stabilityPool.getTotalLUSDDeposits()
    assert.equal(recordedETHBalance, 0)
  })
})

contract('ActivePool', async accounts => {

  let activePool, mockBorrowerOperations, collateralConfig, troveManager, mockRedemptionHelper
  let collaterals, vaults
  let treasury
  let lqtyStaking
  let stabilityPool

  const [owner, alice] = accounts;
  beforeEach(async () => {
    const multisig = "0x5b5e5CC89636CA2685b4e4f50E66099EBCFAb638"  // Arbitrary address for the multisig, which is not tested in this file
    const collateral1 = await ERC20.new("Wrapped Ether", "wETH", 12, multisig, 0); // 12 decimal places
    const collateral2 = await ERC20.new("Wrapped Bitcoin", "wBTC", 8, multisig, 0); // 8 decimal places
    const vault1 = await ERC4626.new(collateral1.address, "wETH Crypt", "rfwETH");
    const vault2 = await ERC4626.new(collateral2.address, "wBTC Crypt", "rfwBTC");
    collaterals = [collateral1, collateral2]
    vaults = [vault1, vault2]

    activePool = await ActivePool.new()
    collateralConfig = await CollateralConfig.new()
    troveManager = await TroveManager.new()
    mockRedemptionHelper = await NonPayable.new()
    mockBorrowerOperations = await NonPayable.new()
    treasury = await NonPayable.new()
    lqtyStaking = await LQTYStaking.new()
    stabilityPool = await StabilityPool.new()
    const dumbContractAddress = (await NonPayable.new()).address
    await collateralConfig.initialize(
      [collateral1.address, collateral2.address],
      [toBN(dec(12, 17)), toBN(dec(13, 17))], // MCR for WETH at 120%, and for WBTC at 130%
      [toBN(dec(165, 16)), toBN(dec(18, 17))] // CCR for WETH at 165%, and for WBTC at 180%
    )

    await troveManager.setAddresses(
      mockBorrowerOperations.address,
      collateralConfig.address,
      activePool.address,
      dumbContractAddress,
      stabilityPool.address,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      lqtyStaking.address,
      mockRedemptionHelper.address
    )

    await activePool.setAddresses(
      collateralConfig.address,
      mockBorrowerOperations.address,
      troveManager.address,
      stabilityPool.address,
      dumbContractAddress,
      dumbContractAddress,
      treasury.address,
      lqtyStaking.address,
      vaults.map(v => v.address)
    )

    await lqtyStaking.setAddresses(
      dumbContractAddress,
      dumbContractAddress,
      troveManager.address,
      dumbContractAddress,
      activePool.address,
      collateralConfig.address
    )

    await stabilityPool.setAddresses(
      dumbContractAddress,
      collateralConfig.address,
      troveManager.address,
      activePool.address,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
      dumbContractAddress,
    )
  })

  it('getCollateral(): gets the recorded Collateral balance', async () => {
    const recordedCollateralBalance = await activePool.getCollateral(collaterals[0].address)
    assert.equal(recordedCollateralBalance, 0)
  })

  it('getLUSDDebt(): gets the recorded LUSD balance', async () => {
    const recordedETHBalance = await activePool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedETHBalance, 0)
  })
 
  it('increaseLUSD(): increases the recorded LUSD balance by the correct amount', async () => {
    const recordedLUSD_balanceBefore = await activePool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceBefore, 0)

    // await activePool.increaseLUSDDebt(100, { from: mockBorrowerOperationsAddress })
    const increaseLUSDDebtData = th.getTransactionData('increaseLUSDDebt(address,uint256)', [collaterals[0].address, '0x64'])
    const tx = await mockBorrowerOperations.forward(activePool.address, increaseLUSDDebtData)
    assert.isTrue(tx.receipt.status)
    const recordedLUSD_balanceAfter = await activePool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceAfter, 100)
  })
  // Decrease
  it('decreaseLUSD(): decreases the recorded LUSD balance by the correct amount', async () => {
    // start the pool on 100 wei
    //await activePool.increaseLUSDDebt(100, { from: mockBorrowerOperationsAddress })
    const increaseLUSDDebtData = th.getTransactionData('increaseLUSDDebt(address,uint256)', [collaterals[0].address, '0x64'])
    const tx1 = await mockBorrowerOperations.forward(activePool.address, increaseLUSDDebtData)
    assert.isTrue(tx1.receipt.status)

    const recordedLUSD_balanceBefore = await activePool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceBefore, 100)

    //await activePool.decreaseLUSDDebt(100, { from: mockBorrowerOperationsAddress })
    const decreaseLUSDDebtData = th.getTransactionData('decreaseLUSDDebt(address,uint256)', [collaterals[0].address, '0x64'])
    const tx2 = await mockBorrowerOperations.forward(activePool.address, decreaseLUSDDebtData)
    assert.isTrue(tx2.receipt.status)
    const recordedLUSD_balanceAfter = await activePool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceAfter, 0)
  })

  // send collateral
  it('sendCollateral(): decreases the recorded collateral balance by the correct amount', async () => {
    // setup: give pool 2 ether
    const activePool_initialBalance = await collaterals[0].balanceOf(activePool.address)
    assert.equal(activePool_initialBalance, 0)
    // start pool with 2 ether
    //await web3.eth.sendTransaction({ from: mockBorrowerOperationsAddress, to: activePool.address, value: dec(2, 'ether') })
    await collaterals[0].mint(mockBorrowerOperations.address, dec(2, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(2, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(2, 'ether'))])
    const tx1 = await mockBorrowerOperations.forward(activePool.address, pullCollData)
    assert.isTrue(tx1.receipt.status)

    const activePool_BalanceBeforeTx = await collaterals[0].balanceOf(activePool.address)
    const alice_Balance_BeforeTx = await collaterals[0].balanceOf(alice)

    assert.equal(activePool_BalanceBeforeTx, dec(2, 'ether'))

    // send collateral from pool to alice
    //await activePool.sendETH(alice, dec(1, 'ether'), { from: mockBorrowerOperationsAddress })
    const sendCollData = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
    const tx2 = await mockBorrowerOperations.forward(activePool.address, sendCollData, { from: owner })
    assert.isTrue(tx2.receipt.status)

    const activePool_BalanceAfterTx = await collaterals[0].balanceOf(activePool.address)
    const alice_Balance_AfterTx = await collaterals[0].balanceOf(alice)

    const alice_BalanceChange = alice_Balance_AfterTx.sub(alice_Balance_BeforeTx)
    const pool_BalanceChange = activePool_BalanceAfterTx.sub(activePool_BalanceBeforeTx)
    assert.equal(alice_BalanceChange, dec(1, 'ether'))
    assert.equal(pool_BalanceChange, _minus_1_Ether)
  })

  // collateral yielding tests
  it('vault addresses are set correctly', async () => {
    assert.equal(await activePool.yieldGenerator(collaterals[0].address), vaults[0].address);
    assert.equal(await activePool.yieldGenerator(collaterals[1].address), vaults[1].address);
  })

  it('default yielding percentages are 0', async () => {
    assert.equal((await activePool.yieldingPercentage(collaterals[0].address)).toString(), '0');
    assert.equal((await activePool.yieldingPercentage(collaterals[1].address)).toString(), '0');
  })

  it('default yielding amounts are 0', async () => {
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)).toString(), '0');
    assert.equal((await activePool.yieldingAmount(collaterals[1].address)).toString(), '0');
  })

  it('default yield claim thresholds are 0', async () => {
    assert.equal((await activePool.yieldClaimThreshold(collaterals[0].address)).toString(), '0');
    assert.equal((await activePool.yieldClaimThreshold(collaterals[1].address)).toString(), '0');
  })

  it('default yield percentage drift is 1%', async () => {
    assert.equal((await activePool.yieldingPercentageDrift()).toString(), '100');
  })

  it('default yield split for treasury is 20%', async () => {
    assert.equal((await activePool.yieldSplitTreasury()).toString(), '2000');
  })

  it('default yield split for stability pool is 40%', async () => {
    assert.equal((await activePool.yieldSplitSP()).toString(), '4000');
  })

  it('default yield split for stakers is 40%', async () => {
    assert.equal((await activePool.yieldSplitStaking()).toString(), '4000');
  })

  it('sendCollateral works with default values, vault share bal is 0 before and after', async () => {
    // start pool with 2 ether
    await collaterals[0].mint(mockBorrowerOperations.address, dec(2, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(2, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(2, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)

    const activePool_CollBalBefore = await collaterals[0].balanceOf(activePool.address)
    const alice_CollBalBefore = await collaterals[0].balanceOf(alice)
    const activePool_VaultBalBefore = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalBefore, dec(2, 'ether'))
    assert.equal(activePool_VaultBalBefore, 0)

    // send 1 ether to alice
    const sendCollData = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, sendCollData, { from: owner })

    const activePool_CollBalAfter = await collaterals[0].balanceOf(activePool.address)
    const alice_CollBalAfter = await collaterals[0].balanceOf(alice)
    const activePool_VaultBalAfter = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalAfter, dec(1, 'ether'))
    assert.equal(activePool_VaultBalAfter, 0)
    assert.equal(alice_CollBalAfter.sub(alice_CollBalBefore), dec(1, 'ether'))
  })

  it('pullCollateral works with default values, vault share bal is 0 before and after', async () => {
    // start pool with 2 ether
    await collaterals[0].mint(mockBorrowerOperations.address, dec(2, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(2, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(2, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)

    const activePool_CollBalBefore = await collaterals[0].balanceOf(activePool.address)
    const activePool_VaultBalBefore = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalBefore, dec(2, 'ether'))
    assert.equal(activePool_VaultBalBefore, 0)

    // pull some more collateral from borrower ops
    await collaterals[0].mint(mockBorrowerOperations.address, dec(3, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(3, 'ether'))
    const pullCollData2 = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(3, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData2)

    const activePool_CollBalAfter = await collaterals[0].balanceOf(activePool.address)
    const activePool_VaultBalAfter = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalAfter, dec(5, 'ether'))
    assert.equal(activePool_VaultBalAfter, 0)
  })

  it('manualRebalance works with default values, vault share bal is 0 before and after', async () => {
    // start pool with 2 ether
    await collaterals[0].mint(mockBorrowerOperations.address, dec(2, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(2, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(2, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)

    const activePool_CollBalBefore = await collaterals[0].balanceOf(activePool.address)
    const activePool_VaultBalBefore = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalBefore, dec(2, 'ether'))
    assert.equal(activePool_VaultBalBefore, 0)

    // try to manual rebalance whilst simulating 1 ether leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(1, 'ether'), { from: owner });

    const activePool_CollBalAfter = await collaterals[0].balanceOf(activePool.address)
    const activePool_VaultBalAfter = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalAfter, dec(2, 'ether'))
    assert.equal(activePool_VaultBalAfter, 0)

    // try to manual rebalance again whilst simulating 2 ether leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(2, 'ether'), { from: owner });

    const activePool_CollBalFinal = await collaterals[0].balanceOf(activePool.address)
    const activePool_VaultBalFinal = await vaults[0].balanceOf(activePool.address)

    assert.equal(activePool_CollBalFinal, dec(2, 'ether'))
    assert.equal(activePool_VaultBalFinal, 0)
  })

  it('non-owner cannot update yielding percentage for any collateral', async () => {
    try {
      const txAlice = await activePool.setYieldingPercentage(collaterals[0].address, 4000, { from: alice })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('owner cannot set yielding percentage for any collateral > 10k', async () => {
    try {
      const txOwner = await activePool.setYieldingPercentage(collaterals[0].address, 10001, { from: owner })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('only owner can set yielding percentage for any collateral <= 10k', async () => {
    const txOwner = await activePool.setYieldingPercentage(collaterals[0].address, 9000, { from: owner })
    assert.equal((await activePool.yieldingPercentage(collaterals[0].address)).toString(), '9000');
  })

  it('non-owner cannot update yielding percentage drift', async () => {
    try {
      const txAlice = await activePool.setYieldingPercentageDrift(400, { from: alice })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('owner cannot set yielding percentage drift > 500', async () => {
    try {
      const txOwner = await activePool.setYieldingPercentageDrift(501, { from: owner })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('only owner can set yielding percentage drift <= 500', async () => {
    const txOwner = await activePool.setYieldingPercentageDrift(400, { from: owner })
    assert.equal((await activePool.yieldingPercentageDrift()).toString(), '400');
  })

  it('non-owner cannot update yield claim threshold for any collateral', async () => {
    try {
      const txAlice = await activePool.setYieldClaimThreshold(collaterals[0].address, dec(1, 'ether'), { from: alice })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('only owner can set yield claim threshold for any collateral', async () => {
    const txOwner = await activePool.setYieldClaimThreshold(collaterals[0].address, dec(1, 'ether'), { from: owner })
    assert.equal(await activePool.yieldClaimThreshold(collaterals[0].address), dec(1, 'ether'));
  })

  it('non-owner cannot update yield distribution split', async () => {
    try {
      const txAlice = await activePool.setYieldDistributionParams(4000, 4000, 2000, { from: alice })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('owner cannot set yield distribution split such that sum is not 10k', async () => {
    try {
      const txOwner = await activePool.setYieldDistributionParams(3300, 3300, 3333, { from: owner })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('only owner can set yield distribution such that sum is 10k', async () => {
    const txOwner = await activePool.setYieldDistributionParams(2500, 4500, 3000, { from: owner })
    assert.equal((await activePool.yieldSplitTreasury()).toString(), '2500');
    assert.equal((await activePool.yieldSplitSP()).toString(), '4500');
    assert.equal((await activePool.yieldSplitStaking()).toString(), '3000');
  })

  it('non-owner cannot call manualRebalance', async () => {
    try {
      const txAlice = await activePool.manualRebalance(collaterals[0].address, dec(1, 'ether'), { from: alice })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('only owner can call manualRebalance', async () => {
    const txOwner = await activePool.manualRebalance(collaterals[0].address, dec(0, 'ether'), { from: owner })
  })

  const setReasonableDefaultStateForYielding = async () => {
    await activePool.setYieldingPercentage(collaterals[0].address, 5000, { from: owner })
    await activePool.setYieldingPercentage(collaterals[1].address, 5000, { from: owner })

    await activePool.setYieldClaimThreshold(collaterals[0].address, 10000, { from: owner })
    await activePool.setYieldClaimThreshold(collaterals[1].address, 10000, { from: owner })

    await activePool.setYieldDistributionParams(2000, 3000, 5000, { from: owner })

    // start pool with 10 ether
    await collaterals[0].mint(mockBorrowerOperations.address, dec(10, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(10, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(10, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)
  }

  it('reasonableDefaultState: verify yielding amounts + vault share balances are correct', async () => {
    await setReasonableDefaultStateForYielding();

    assert.equal(await activePool.yieldingAmount(collaterals[0].address), dec(5, 'ether'));
    assert.equal(await activePool.yieldingAmount(collaterals[1].address), 0);

    const vault0shareBal = await vaults[0].balanceOf(activePool.address);
    const vault1shareBal = await vaults[1].balanceOf(activePool.address);

    assert.equal(vault0shareBal, dec(5, 'ether'));
    assert.equal(vault1shareBal, 0);
  })

  it('simulate profit, check that send collateral distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // send out 1 ether of collateral
    const sendCollData = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, sendCollData, { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool is left with 10 - 1 = 9 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(9, 'ether'));

    // half is in pool itself, half is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '4500000000000000000') // 4.5 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '4500000000000000000') // 4.5 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '4500000000000000000')
  })

  it('simulate profit and increase yielding percentage, check that send collateral distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // increase yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 6000, { from: owner })

    // send out 1 ether of collateral
    const sendCollData = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, sendCollData, { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool is left with 10 - 1 = 9 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(9, 'ether'));

    // 40% is in pool itself, 60% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '3600000000000000000') // 3.6 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '5400000000000000000') // 5.4 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '5400000000000000000')
  })

  it('simulate profit and reduce yielding percentage, check that send collateral distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // reduce yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 3500, { from: owner })

    // send out 1 ether of collateral
    const sendCollData = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, sendCollData, { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool is left with 10 - 1 = 9 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(9, 'ether'));

    // 65% is in pool itself, 35% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '5850000000000000000') // 5.85 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '3150000000000000000') // 3.15 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '3150000000000000000')

    // simulate more profit: mint 2 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(2, 'ether'))

    // send out another ether of collateral
    const sendCollData2 = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, sendCollData2, { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '600000000000000000') // 0.2 + 0.4 = 0.6 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '900000000000000000') // 0.3 + 0.6 = 0.9 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '1500000000000000000') // 0.5 + 1.0 = 1.5 ether ether

    // activePool is left with 9 - 1 = 8 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(8, 'ether'));

    // 65% is in pool itself, 35% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '5200000000000000000') // 5.2 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '2800000000000000000') // 2.8 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '2800000000000000000')
  })

  it('simulate loss, check that send collateral reverts', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate loss: burn 1 ether of vault
    await collaterals[0].burn(vaults[0].address, dec(1, 'ether'))

    // attempt to send out 1 ether of collateral
    try {
      const sendCollData = th.getTransactionData('sendCollateral(address,address,uint256)', [collaterals[0].address, alice, web3.utils.toHex(dec(1, 'ether'))])
      await mockBorrowerOperations.forward(activePool.address, sendCollData, { from: owner })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('simulate profit, check that pull collateral distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // pull 3 more ether of collateral
    await collaterals[0].mint(mockBorrowerOperations.address, dec(3, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(3, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(3, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool is left with 10 + 3 = 13 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(13, 'ether'));

    // half is in pool itself, half is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '6500000000000000000') // 6.5 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '6500000000000000000') // 4.5 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '6500000000000000000')
  })

  it('simulate profit and increase yielding percentage, check that pull collateral distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // increase yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 6000, { from: owner })

    // pull 3 more ether of collateral
    await collaterals[0].mint(mockBorrowerOperations.address, dec(3, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(3, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(3, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool is left with 10 + 3 = 13 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(13, 'ether'));

    // 40% is in pool itself, 60% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '5200000000000000000') // 5.2 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '7800000000000000000') // 7.8 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '7800000000000000000')
  })

  it('simulate profit and reduce yielding percentage, check that pull collateral distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // reduce yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 3500, { from: owner })

    // pull 3 more ether of collateral
    await collaterals[0].mint(mockBorrowerOperations.address, dec(3, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(3, 'ether'))
    const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(3, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData)

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool is left with 10 + 1 = 13 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(13, 'ether'));

    // 65% is in pool itself, 35% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '8450000000000000000') // 8.45 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '4550000000000000000') // 4.55 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '4550000000000000000')

    // simulate more profit: mint 2 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(2, 'ether'))

    // pull 7 more ether of collateral
    await collaterals[0].mint(mockBorrowerOperations.address, dec(7, 'ether'))
    await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(7, 'ether'))
    const pullCollData2 = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(7, 'ether'))])
    await mockBorrowerOperations.forward(activePool.address, pullCollData2)

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '600000000000000000') // 0.2 + 0.4 = 0.6 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '900000000000000000') // 0.3 + 0.6 = 0.9 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '1500000000000000000') // 0.5 + 1.0 = 1.5 ether ether

    // activePool is left with 13 + 7 = 20 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(20, 'ether'));

    // 65% is in pool itself, 35% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '13000000000000000000') // 13 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '7000000000000000000') // 7 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '7000000000000000000')
  })

  it('simulate loss, check that pull collateral reverts', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate loss: burn 1 ether of vault
    await collaterals[0].burn(vaults[0].address, dec(1, 'ether'))

    try {
      // pull 3 more ether of collateral
      await collaterals[0].mint(mockBorrowerOperations.address, dec(3, 'ether'))
      await collaterals[0].approveInternal(mockBorrowerOperations.address, activePool.address, dec(3, 'ether'))
      const pullCollData = th.getTransactionData('pullCollateralFromBorrowerOperationsOrDefaultPool(address,uint256)', [collaterals[0].address, web3.utils.toHex(dec(3, 'ether'))])
      await mockBorrowerOperations.forward(activePool.address, pullCollData)
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })

  it('simulate profit, check that manual rebalance distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // trigger manual rebalance
    await activePool.manualRebalance(collaterals[0].address, dec(0, 'ether'), { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // half is in pool itself, half is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '5000000000000000000') // 5 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '5000000000000000000') // 5 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '5000000000000000000')

    // trigger another manual rebalance whilst simulating some collateral leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(2, 'ether'), { from: owner })

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // but now only half of (10 - 2) ether should be in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '6000000000000000000') // 6 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '4000000000000000000') // 4 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '4000000000000000000')

    // simulate some more profit: mint 2 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(2, 'ether'))

    // trigger another manual rebalance whilst simulating some collateral leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(1, 'ether'), { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '600000000000000000') // 0.2 + 0.4 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '900000000000000000') // 0.3 + 0.6 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '1500000000000000000') // 0.5 + 1 ether

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // but now only half of (10 - 1) ether should be in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '5500000000000000000') // 5.5 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '4500000000000000000') // 4.5 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '4500000000000000000')
  })

  it('simulate profit and increase yielding percentage, check that manual rebalance distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // increase yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 6000, { from: owner })

    // trigger manual rebalance
    await activePool.manualRebalance(collaterals[0].address, dec(0, 'ether'), { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // 40% in pool itself, 60% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '4000000000000000000') // 4 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '6000000000000000000') // 6 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '6000000000000000000')

    // trigger another manual rebalance whilst simulating some collateral leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(2, 'ether'), { from: owner })

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // but now 60% of (10 - 2) ether should be in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '5200000000000000000') // 5.2 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '4800000000000000000') // 4.8 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '4800000000000000000')

    // simulate some more profit: mint 2 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(2, 'ether'))

    // further increase yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 7500, { from: owner })

    // trigger another manual rebalance whilst simulating some collateral leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(1, 'ether'), { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '600000000000000000') // 0.2 + 0.4 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '900000000000000000') // 0.3 + 0.6 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '1500000000000000000') // 0.5 + 1 ether

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // but now 75% of (10 - 1) ether should be in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '3250000000000000000') // 3.25 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '6750000000000000000') // 6.75 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '6750000000000000000')
  })

  it('simulate profit and reduce yielding percentage, check that manual rebalance distributes profit', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate profit: mint 1 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(1, 'ether'))

    // reduce yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 4000, { from: owner })

    // trigger manual rebalance
    await activePool.manualRebalance(collaterals[0].address, dec(0, 'ether'), { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '200000000000000000') // 0.2 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '300000000000000000') // 0.3 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '500000000000000000') // 0.5 ether

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // 60% in pool itself, 40% is in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '6000000000000000000') // 6 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '4000000000000000000') // 4 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '4000000000000000000')

    // trigger another manual rebalance whilst simulating some collateral leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(2, 'ether'), { from: owner })

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // but now 40% of (10 - 2) ether should be in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '6800000000000000000') // 6.8 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '3200000000000000000') // 3.2 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '3200000000000000000')

    // simulate some more profit: mint 2 ether to vault
    await collaterals[0].mint(vaults[0].address, dec(2, 'ether'))

    // further reduce yielding percentage
    await activePool.setYieldingPercentage(collaterals[0].address, 2500, { from: owner })

    // trigger another manual rebalance whilst simulating some collateral leaving pool
    await activePool.manualRebalance(collaterals[0].address, dec(1, 'ether'), { from: owner })

    // check profit distribution
    assert.equal((await collaterals[0].balanceOf(treasury.address)).toString(), '600000000000000000') // 0.2 + 0.4 ether
    assert.equal((await collaterals[0].balanceOf(stabilityPool.address)).toString(), '900000000000000000') // 0.3 + 0.6 ether
    assert.equal((await collaterals[0].balanceOf(lqtyStaking.address)).toString(), '1500000000000000000') // 0.5 + 1 ether

    // activePool still has 10 ether of collateral
    assert.equal(await activePool.getCollateral(collaterals[0].address), dec(10, 'ether'));

    // but now 25% of (10 - 1) ether should be in vault
    assert.equal((await collaterals[0].balanceOf(activePool.address)), '7750000000000000000') // 7.75 ether
    assert.equal((await activePool.yieldingAmount(collaterals[0].address)), '2250000000000000000') // 2.25 ether
    assert.equal((await collaterals[0].balanceOf(vaults[0].address)), '2250000000000000000')
  })

  it('simulate loss, check that manual rebalance reverts', async () => {
    await setReasonableDefaultStateForYielding();

    // simulate loss: burn 1 ether of vault
    await collaterals[0].burn(vaults[0].address, dec(1, 'ether'))

    try {
      // trigger manual rebalance
    await activePool.manualRebalance(collaterals[0].address, dec(0, 'ether'), { from: owner })
    } catch (err) {
      assert.include(err.message, "revert")
    }
  })
})

contract('DefaultPool', async accounts => {
 
  let defaultPool, collateralConfig, mockTroveManager, mockActivePool
  let collaterals

  const [owner, alice] = accounts;
  before(async () => {
    const multisig = "0x5b5e5CC89636CA2685b4e4f50E66099EBCFAb638"  // Arbitrary address for the multisig, which is not tested in this file
    const collateral1 = await ERC20.new("Wrapped Ether", "wETH", 12, multisig, 0); // 12 decimal places
    const collateral2 = await ERC20.new("Wrapped Bitcoin", "wBTC", 8, multisig, 0); // 8 decimal places

    collaterals = [collateral1, collateral2];
  })

  beforeEach(async () => {
    defaultPool = await DefaultPool.new()
    collateralConfig = await CollateralConfig.new()
    mockTroveManager = await NonPayable.new()
    mockActivePool = await NonPayable.new()
    await collateralConfig.initialize(
      collaterals.map(c => c.address),
      [toBN(dec(12, 17)), toBN(dec(13, 17))], // MCR for WETH at 120%, and for WBTC at 130%
      [toBN(dec(165, 16)), toBN(dec(18, 17))] // CCR for WETH at 165%, and for WBTC at 180%
    )
    await defaultPool.setAddresses(collateralConfig.address, mockTroveManager.address, mockActivePool.address)
  })

  it('getCollateral(): gets the recorded collateral balance', async () => {
    const recordedCollateralBalance = await defaultPool.getCollateral(collaterals[0].address)
    assert.equal(recordedCollateralBalance, 0)
  })

  it('getLUSDDebt(): gets the recorded LUSD balance', async () => {
    const recordedETHBalance = await defaultPool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedETHBalance, 0)
  })
 
  it('increaseLUSD(): increases the recorded LUSD balance by the correct amount', async () => {
    const recordedLUSD_balanceBefore = await defaultPool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceBefore, 0)

    // await defaultPool.increaseLUSDDebt(100, { from: mockBorrowerOperationsAddress })
    const increaseLUSDDebtData = th.getTransactionData('increaseLUSDDebt(address,uint256)', [collaterals[0].address, '0x64'])
    const tx = await mockTroveManager.forward(defaultPool.address, increaseLUSDDebtData)
    assert.isTrue(tx.receipt.status)
    const recordedLUSD_balanceAfter = await defaultPool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceAfter, 100)
  })
  
  it('decreaseLUSD(): decreases the recorded LUSD balance by the correct amount', async () => {
    // start the pool on 100 wei
    //await defaultPool.increaseLUSDDebt(100, { from: mockTroveManagerAddress })
    const increaseLUSDDebtData = th.getTransactionData('increaseLUSDDebt(address,uint256)', [collaterals[0].address, '0x64'])
    const tx1 = await mockTroveManager.forward(defaultPool.address, increaseLUSDDebtData)
    assert.isTrue(tx1.receipt.status)

    const recordedLUSD_balanceBefore = await defaultPool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceBefore, 100)

    //await defaultPool.decreaseLUSDDebt(100, { from: mockTroveManagerAddress })
    const decreaseLUSDDebtData = th.getTransactionData('decreaseLUSDDebt(address,uint256)', [collaterals[0].address, '0x64'])
    const tx2 = await mockTroveManager.forward(defaultPool.address, decreaseLUSDDebtData)
    assert.isTrue(tx2.receipt.status)
    const recordedLUSD_balanceAfter = await defaultPool.getLUSDDebt(collaterals[0].address)
    assert.equal(recordedLUSD_balanceAfter, 0)
  })
})

contract('Reset chain state', async accounts => {})
