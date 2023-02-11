const deploymentHelper = require("../utils/deploymentHelpers.js")
const testHelpers = require("../utils/testHelpers.js")
const StabilityPool = artifacts.require("./StabilityPool.sol")

const th = testHelpers.TestHelper
const dec = th.dec

contract('Oath community issuance tests', async accounts => {
  let contracts
  let communityIssuanceTester
  let oathToken
  let stabilityPool

  const thousand = th.toBN(dec(1000, 18));
  const million = th.toBN(dec(1000000, 18));

  const [owner, alice] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  const setupFunder = async (account, oathToken, communityIssuanceTester, amount) => {
    await oathToken.mint(account, amount);
    await oathToken.approve(communityIssuanceTester.address, amount);
  }


  before(async () => {

  })

  beforeEach(async () => {
    contracts = await deploymentHelper.deployTestCollaterals(await deploymentHelper.deployLiquityCore())
    const LQTYContracts = await deploymentHelper.deployLQTYTesterContractsHardhat(multisig)
    contracts.stabilityPool = await StabilityPool.new()
    contracts = await deploymentHelper.deployLUSDToken(contracts)

    stabilityPool = contracts.stabilityPool
    borrowerOperations = contracts.borrowerOperations

    oathToken = LQTYContracts.oathToken
    communityIssuanceTester = LQTYContracts.communityIssuance

    await deploymentHelper.connectLQTYContracts(LQTYContracts)
    await deploymentHelper.connectCoreContracts(contracts, LQTYContracts)
    await deploymentHelper.connectLQTYContractsToCore(LQTYContracts, contracts)
  })

  it("fund(): Oath shows up at the contract address", async () => {
      await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
      await communityIssuanceTester.fund(thousand);
      const lqtyBalance = await oathToken.balanceOf(communityIssuanceTester.address);
      assert.isTrue(lqtyBalance.eq(thousand));
  })

  it("fund(): Oath is deducted from caller balance", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    const balanceBefore = await oathToken.balanceOf(accounts[0]);
    await communityIssuanceTester.fund(thousand);
    const balanceAfter = await oathToken.balanceOf(accounts[0]);
    assert.isTrue(balanceBefore.sub(balanceAfter).eq(thousand));
    await th.fastForwardTime(10000, web3.currentProvider);
    await communityIssuanceTester.fund(thousand);
    const lastBalance = await oathToken.balanceOf(accounts[0]);
    assert.isTrue(balanceAfter.sub(lastBalance).eq(thousand));
  })

  it("fund(): cannot fund 0", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    let tx = communityIssuanceTester.fund(0);
    await th.assertRevert(tx, "cannot fund 0");
  })

  it("fund(): Updates last distribution time to distributionPeriod days after call", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    const distributionPeriod = await communityIssuanceTester.distributionPeriod();
    const lastDistributionInitial = await communityIssuanceTester.lastDistributionTime();

    await communityIssuanceTester.fund(thousand);
    const blockTimestampOne = th.toBN(await th.getLatestBlockTimestamp(web3));
    const lastDistributionOne = await communityIssuanceTester.lastDistributionTime();
    await th.fastForwardTime(100, web3.currentProvider);

    await communityIssuanceTester.fund(thousand);
    const blockTimestampTwo = th.toBN(await th.getLatestBlockTimestamp(web3));
    const lastDistributionTwo = await communityIssuanceTester.lastDistributionTime();
    await th.fastForwardTime(100, web3.currentProvider);

    await communityIssuanceTester.fund(thousand);
    const blockTimestampThree = th.toBN(await th.getLatestBlockTimestamp(web3));
    const lastDistributionThree = await communityIssuanceTester.lastDistributionTime();

    // just being thorough
    assert.isTrue(lastDistributionInitial.eq(th.toBN(0)));
    assert.isTrue(lastDistributionTwo.sub(lastDistributionOne).eq(blockTimestampTwo.sub(blockTimestampOne)));
    assert.isTrue(lastDistributionThree.sub(lastDistributionOne).eq(blockTimestampThree.sub(blockTimestampOne)));
    assert.isTrue(lastDistributionThree.sub(lastDistributionTwo).eq(blockTimestampThree.sub(blockTimestampTwo)));
    assert.isTrue(lastDistributionOne.sub(blockTimestampOne).eq(distributionPeriod));
    assert.isTrue(lastDistributionTwo.sub(blockTimestampTwo).eq(distributionPeriod));
    assert.isTrue(lastDistributionThree.sub(blockTimestampThree).eq(distributionPeriod));
  })

  it("fund(): Updates rewards per second to the proper amount", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    const distributionPeriod = await communityIssuanceTester.distributionPeriod();

    await communityIssuanceTester.fund(thousand);
    const rps = await communityIssuanceTester.rewardPerSecond();
    const expectedRPS = thousand.div(distributionPeriod);
    assert.isTrue(rps.eq(expectedRPS));
  })

  it("fund(): Can only be called by owner", async () => {
    await setupFunder(alice, oathToken, communityIssuanceTester, million);
    let tx = communityIssuanceTester.fund(thousand, {from: alice});
    await th.assertRevert(tx, "Ownable: caller is not the owner");
  })

  it("updateDistributionPeriod(): Can only be called by owner", async () => {
    await setupFunder(alice, oathToken, communityIssuanceTester, million);
    let tx = communityIssuanceTester.updateDistributionPeriod(86400, {from: alice});
    await th.assertRevert(tx, "Ownable: caller is not the owner");
  })

  it("Issues a set amount of rewards per second", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await communityIssuanceTester.fund(thousand);
    const blockTimestampOne = await th.getLatestBlockTimestamp(web3);
    await th.fastForwardTime(100, web3.currentProvider);

    await communityIssuanceTester.unprotectedIssueLQTY();
    const issuance = await communityIssuanceTester.totalOATHIssued();
    const blockTimestampTwo = await th.getLatestBlockTimestamp(web3);

    const rps = await communityIssuanceTester.rewardPerSecond();
    const difference = blockTimestampTwo - blockTimestampOne;

    assert.isTrue(issuance.eq(th.toBN(difference).mul(rps)));
  })

  it("issues 0 when funds have been fully issued", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await communityIssuanceTester.fund(thousand);
    await th.fastForwardTime(1300000, web3.currentProvider);

    await communityIssuanceTester.unprotectedIssueLQTY();
    const firstIssuance = await communityIssuanceTester.totalOATHIssued();
    await communityIssuanceTester.unprotectedIssueLQTY();
    const secondIssuance = (await communityIssuanceTester.totalOATHIssued()).sub(firstIssuance);

    th.assertIsApproximatelyEqual(firstIssuance, thousand, 10**7)
    assert.isTrue(secondIssuance.eq(th.toBN(0)));
  })

  it("issues 0 when the contract hasn't been funded", async () => {
    await communityIssuanceTester.unprotectedIssueLQTY();
    const firstIssuance = await communityIssuanceTester.totalOATHIssued();
    assert.isTrue(firstIssuance.eq(th.toBN(0)));
  })

  it("cannot set addresses more than once", async () => {
    let tx = communityIssuanceTester.setAddresses(oathToken.address, stabilityPool.address);
    await th.assertRevert(tx, "issuance has been initialized");
  })

  it("has the proper owner", async () => {
    let ownr = await communityIssuanceTester.owner();
    assert.equal(ownr, accounts[0]);
  })

  it("aggregates multiple funding rounds within a distribution period", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await communityIssuanceTester.fund(thousand);
    const rps1 = await communityIssuanceTester.rewardPerSecond();
    await th.fastForwardTime(604800, web3.currentProvider); // 7 days pass
    await communityIssuanceTester.fund(thousand);
    const rps2 = await communityIssuanceTester.rewardPerSecond();
    await th.fastForwardTime(604800, web3.currentProvider);
    await communityIssuanceTester.fund(thousand);
    const rps3 = await communityIssuanceTester.rewardPerSecond();
    const final = (rps1 * 604800) + (rps2  * 604800) + (rps3  * 1209600);
    th.assertIsApproximatelyEqual(parseInt(final), parseInt(thousand*3), 1000);
  })

  it("only adds OATH sent through fund() to the distribution", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await oathToken.transfer(communityIssuanceTester.address, thousand);
    await communityIssuanceTester.fund(thousand);
    const distributionPeriod = await communityIssuanceTester.distributionPeriod();
    const rps = await communityIssuanceTester.rewardPerSecond();
    const expectedRPS = th.toBN(dec(1000, 18)).div(distributionPeriod);
    assert.equal(Number(rps), Number(expectedRPS));
  })

  it("rewards the proper amount each day", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await communityIssuanceTester.fund(th.toBN(dec(7000, 18)));

    for (let i=0; i<14; i++) {
      const lastTotalIssuance = await communityIssuanceTester.totalOATHIssued();
      await th.fastForwardTime(86400, web3.currentProvider);
      await communityIssuanceTester.unprotectedIssueLQTY();
      const issuance = (await communityIssuanceTester.totalOATHIssued()).sub(lastTotalIssuance);
      const error = issuance.sub(thousand.div(th.toBN(2)));
      assert.isTrue(error.lt(th.toBN(th.dec(1, 16)))); // expecting daily distribution of 500 OATH within error of 0.01 OATH
    }

    const lastTotalIssuance = await communityIssuanceTester.totalOATHIssued();
    await th.fastForwardTime(86400, web3.currentProvider);
    await communityIssuanceTester.unprotectedIssueLQTY();
    const issuance = (await communityIssuanceTester.totalOATHIssued()).sub(lastTotalIssuance);
    assert.isTrue(issuance.eq(th.toBN(0)));
  })

  it("rewards the proper amount each day, with varying distributions", async () => {
    await communityIssuanceTester.updateDistributionPeriod(21 * 86400);
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await communityIssuanceTester.fund(th.toBN(dec(21000, 18)));

    for (let i=0; i<14; i++) {
      const lastTotalIssuance = await communityIssuanceTester.totalOATHIssued();
      await th.fastForwardTime(86400, web3.currentProvider);
      await communityIssuanceTester.unprotectedIssueLQTY();
      const issuance = (await communityIssuanceTester.totalOATHIssued()).sub(lastTotalIssuance);
      const error = issuance.sub(thousand);
      assert.isTrue(error.lt(th.toBN(th.dec(1, 17)))); // expecting daily distribution of 1000 OATH within error of 0.1 OATH
    }

    // fund again before previous lot runs out
    await communityIssuanceTester.fund(th.toBN(dec(21000, 18)));

    for (let i=0; i<21; i++) {
      const lastTotalIssuance = await communityIssuanceTester.totalOATHIssued();
      await th.fastForwardTime(86400, web3.currentProvider);
      await communityIssuanceTester.unprotectedIssueLQTY();
      const issuance = (await communityIssuanceTester.totalOATHIssued()).sub(lastTotalIssuance);
      const error = issuance.sub(thousand.mul(th.toBN(4)).div(th.toBN(3)));
      assert.isTrue(error.lt(th.toBN(th.dec(1, 16)))); // expecting daily distribution of 1333 OATH within error of 0.01 OATH
    }

    const lastTotalIssuance = await communityIssuanceTester.totalOATHIssued();
    await th.fastForwardTime(86400, web3.currentProvider);
    await communityIssuanceTester.unprotectedIssueLQTY();
    const issuance = (await communityIssuanceTester.totalOATHIssued()).sub(lastTotalIssuance);
    assert.isTrue(issuance.eq(th.toBN(0)));
  })

  it("adjusts unissued OATH properly when new funding arrives", async () => {
    await setupFunder(accounts[0], oathToken, communityIssuanceTester, million);
    await communityIssuanceTester.fund(th.toBN(dec(21000, 18))); // ~1500 OATH per day

    await th.fastForwardTime(86400, web3.currentProvider);
    await communityIssuanceTester.unprotectedIssueLQTY();

    // week later, new distribution
    await th.fastForwardTime(7 * 86400, web3.currentProvider);
    await communityIssuanceTester.fund(th.toBN(dec(7000, 18)));

    await communityIssuanceTester.unprotectedIssueLQTY();

    // 5 days later, new distribution
    await th.fastForwardTime(5 * 86400, web3.currentProvider);
    await communityIssuanceTester.fund(th.toBN(dec(5000, 18)));

    await communityIssuanceTester.unprotectedIssueLQTY();

    // days go by
    await th.fastForwardTime(15 * 86400, web3.currentProvider);

    await communityIssuanceTester.unprotectedIssueLQTY();

    // total issued should be roughly 21k + 7k + 5k
    const totalIssued = await communityIssuanceTester.totalOATHIssued();
    const error = th.toBN(dec(33000, 18)).sub(totalIssued);
    assert.isTrue(error.lt(th.toBN(th.dec(1, 18))));
  });
})
