const { expect } = require('chai');
const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")

const toBN = testHelpers.TestHelper.toBN
const dec = testHelpers.TestHelper.dec

contract('CollateralConfig', async accounts => {
  let coreContracts
  let collateralConfig
  let collaterals

  beforeEach(async () => {
    const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(996, 1000)

    coreContracts = await deploymentHelper.deployLiquityCore()
    coreContracts = await deploymentHelper.deployLUSDTokenTester(coreContracts)
    coreContracts = await deploymentHelper.deployTestCollaterals(coreContracts)
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)

    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(coreContracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, coreContracts)

    collateralConfig = coreContracts.collateralConfig
    collaterals = coreContracts.collaterals
  });

  it('sets the right values on initializing', async () => {
    const allowedCollaterals = await collateralConfig.getAllowedCollaterals();
    const expectedAllowedCollaterals = collaterals.map(c => c.address);
    expect(allowedCollaterals).to.eql(expectedAllowedCollaterals);

    expect(await collateralConfig.isCollateralAllowed(collaterals[0].address)).to.be.true;
    expect(await collateralConfig.isCollateralAllowed(collaterals[1].address)).to.be.true;
    expect(await collateralConfig.isCollateralAllowed(accounts[0])).to.be.false;

    expect(await collateralConfig.getCollateralDecimals(collaterals[0].address)).to.eql(toBN('12'));
    expect(await collateralConfig.getCollateralDecimals(collaterals[1].address)).to.eql(toBN('8'));
    testHelpers.TestHelper.assertRevert(
      collateralConfig.getCollateralDecimals(accounts[0]), "Invalid collateral address"
    );

    expect(await collateralConfig.getCollateralMCR(collaterals[0].address)).to.eql(toBN(dec(120, 16)));
    expect(await collateralConfig.getCollateralMCR(collaterals[1].address)).to.eql(toBN(dec(130, 16)));
    testHelpers.TestHelper.assertRevert(
      collateralConfig.getCollateralMCR(accounts[0]), "Invalid collateral address"
    );

    expect(await collateralConfig.getCollateralCCR(collaterals[0].address)).to.eql(toBN(dec(165, 16)));
    expect(await collateralConfig.getCollateralCCR(collaterals[1].address)).to.eql(toBN(dec(180, 16)));
    testHelpers.TestHelper.assertRevert(
      collateralConfig.getCollateralCCR(accounts[0]), "Invalid collateral address"
    );
  });

  it('can be initialized only once', async () => {
    testHelpers.TestHelper.assertRevert(
      collateralConfig.initialize(
        collaterals.map(c => c.address),
        [toBN(dec(12, 17)), toBN(dec(13, 17))], // MCR for WETH at 120%, and for WBTC at 130%
        [toBN(dec(165, 16)), toBN(dec(18, 17))] // CCR for WETH at 165%, and for WBTC at 180%
      ),
      "Can only initialize once"
    );
  });

  it('owner can update CRs but only by lowering them', async () => {
    testHelpers.TestHelper.assertRevert(
      collateralConfig.updateCollateralRatios(
        collaterals[0].address,
        toBN(dec(121, 16)),
        toBN(dec(165, 16))
      ),
      "Can only walk down the MCR"
    );

    testHelpers.TestHelper.assertRevert(
      collateralConfig.updateCollateralRatios(
        collaterals[0].address,
        toBN(dec(120, 16)),
        toBN(dec(166, 16))
      ),
      "Can only walk down the CCR"
    );

    testHelpers.TestHelper.assertRevert(
      collateralConfig.updateCollateralRatios(
        collaterals[0].address,
        toBN(dec(121, 16)),
        toBN(dec(166, 16))
      ),
      "Can only walk down the MCR"
    );

    await collateralConfig.updateCollateralRatios(
      collaterals[0].address,
      toBN(dec(115, 16)),
      toBN(dec(155, 16))
    );
    expect(await collateralConfig.getCollateralMCR(collaterals[0].address)).to.eql(toBN(dec(115, 16)));
    expect(await collateralConfig.getCollateralCCR(collaterals[0].address)).to.eql(toBN(dec(155, 16)));

    testHelpers.TestHelper.assertRevert(
      collateralConfig.updateCollateralRatios(
        collaterals[0].address,
        toBN(dec(105, 16)),
        toBN(dec(155, 16))
      ),
      "MCR below allowed minimum"
    );

    testHelpers.TestHelper.assertRevert(
      collateralConfig.updateCollateralRatios(
        collaterals[0].address,
        toBN(dec(115, 16)),
        toBN(dec(145, 16))
      ),
      "CCR below allowed minimum"
    );
  });
});
