const testHelpers = require("../utils/testHelpers.js")
const CollateralConfig = artifacts.require("./CollateralConfig.sol")
const ActivePool = artifacts.require("./ActivePool.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const NonPayable = artifacts.require('NonPayable.sol')
const ERC20 = artifacts.require("ERC20Mock.sol");
const ERC4626 = artifacts.require("ERC4626.sol");

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('DefaultPool', async accounts => {
  let collateralConfig
  let defaultPool
  let activePool
  let mockTroveManager
  let mockBorrowerOps
  let mockStabilityPool
  let mockCollSurplusPool
  let collateral

  let [owner] = accounts

  beforeEach('Deploy contracts', async () => {
    collateralConfig = await CollateralConfig.new()
    defaultPool = await DefaultPool.new()
    activePool = await ActivePool.new()
    mockTroveManager = await NonPayable.new()
    mockBorrowerOps = await NonPayable.new()
    mockStabilityPool = await NonPayable.new()
    mockCollSurplusPool = await NonPayable.new()
    const mockLQTYStaking = await NonPayable.new()

    const multisig = "0x5b5e5CC89636CA2685b4e4f50E66099EBCFAb638"  // Arbitrary address for the multisig, which is not tested in this file
    collateral = await ERC20.new("Wrapped Ether", "wETH", 12, multisig, 0);
    const vault = await ERC4626.new(collateral.address, "wETH Crypt", "rfwETH");

    await collateralConfig.initialize(
      [collateral.address],
      [toBN(dec(12, 17))], // MCR for WETH at 120%
      [toBN(dec(165, 16))], // CCR for WETH at 165%
    )
    await defaultPool.setAddresses(collateralConfig.address, mockTroveManager.address, activePool.address)
    await activePool.setAddresses(collateralConfig.address, mockBorrowerOps.address, mockTroveManager.address,
      mockStabilityPool.address, defaultPool.address, mockCollSurplusPool.address,
      multisig, mockLQTYStaking.address, [vault.address]
    );
  })

  it('sendCollateralToActivePool(): fails if caller is not TroveManager', async () => {
    const amount = dec(1, 12)
    await th.assertRevert(defaultPool.sendCollateralToActivePool(collateral.address, amount, { from: owner }))
  })
})

contract('Reset chain state', async accounts => { })
