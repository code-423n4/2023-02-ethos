const {time, loadFixture, mine} = require('@nomicfoundation/hardhat-network-helpers');
const {ethers, network, upgrades} = require('hardhat');
const {expect} = require('chai');

const moveTimeForward = async (seconds) => {
  await time.increase(seconds);
};

// eslint-disable-next-line no-unused-vars
const moveBlocksForward = async (blocks) => {
  mine(blocks);
};

const toWantUnit = (num, isWBTC = true) => {
  if (isWBTC) {
    return ethers.utils.parseUnits(num, 8);
  }
  return ethers.utils.parseEther(num);
};

const treasuryAddr = '0xeb9C9b785aA7818B2EBC8f9842926c4B9f707e4B';

const superAdminAddress = '0x9BC776dBb134Ef9D7014dB1823Cd755Ac5015203';
const adminAddress = '0xeb9C9b785aA7818B2EBC8f9842926c4B9f707e4B';
const guardianAddress = '0xb0C9D5851deF8A2Aac4A23031CA2610f8C3483F9';
const gWantAddress = '0xbd3dbf914f3e9c3133a815b04a4d0E5930957cB9';
const wantAddress = '0x68f180fcCe6836688e9084f035309E29Bf0A2095';

const wantHolderAddr = '0xC2Aa89ac54815AAB8195a52983117e9fEF03A719';
const strategistAddr = '0x1E71AEE6081f62053123140aacC7a06021D77348';

const strategists = [strategistAddr];
const multisigRoles = [superAdminAddress, adminAddress, guardianAddress];

describe('Vaults', function () {
  async function deployVaultAndStrategyAndGetSigners() {
    // reset network
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: 'https://late-fragrant-rain.optimism.quiknode.pro/70171d2e7790f3af6a833f808abe5e85ed6bd881',
          },
        },
      ],
    });

    // get signers
    const [owner, unassignedRole] = await ethers.getSigners();
    const wantHolder = await ethers.getImpersonatedSigner(wantHolderAddr);
    const strategist = await ethers.getImpersonatedSigner(strategistAddr);
    const guardian = await ethers.getImpersonatedSigner(guardianAddress);
    const admin = await ethers.getImpersonatedSigner(adminAddress);
    const superAdmin = await ethers.getImpersonatedSigner(superAdminAddress);

    // get artifacts
    const Vault = await ethers.getContractFactory('ReaperVaultERC4626');
    const Strategy = await ethers.getContractFactory('ReaperStrategyGranarySupplyOnly');
    const Want = await ethers.getContractFactory('@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20');

    // deploy contracts
    const vault = await Vault.deploy(
      wantAddress,
      'Ethos Reserve WBTC Vault',
      'ethos-WBTC',
      ethers.constants.MaxUint256,
      treasuryAddr,
      strategists,
      multisigRoles,
    );
    const strategy = await upgrades.deployProxy(Strategy, [vault.address, strategists, multisigRoles, gWantAddress], {
      kind: 'uups',
    });
    await strategy.deployed();
    await vault.addStrategy(strategy.address, 1000, 9000); // feeBPS = 1000, allocBPS = 9000
    const want = Want.attach(wantAddress);

    // approving LP token and vault share spend
    await want.connect(wantHolder).approve(vault.address, ethers.constants.MaxUint256);
    await vault
      .connect(owner)
      .grantRole('0xe16b3d8fc79140c62874442c8b523e98592b429e73c0db67686a5b378b29f336', wantHolderAddr); // DEPOSITOR role

    return {vault, strategy, want, owner, wantHolder, strategist, guardian, admin, superAdmin, unassignedRole};
  }

  describe('Deploying the vault and strategy', function () {
    it('should initiate vault with a 0 balance', async function () {
      const {vault} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const totalBalance = await vault.totalAssets();
      const pricePerFullShare = await vault.getPricePerFullShare();
      expect(totalBalance).to.equal(0);
      expect(pricePerFullShare).to.equal(toWantUnit('1'));
    });

    // Upgrade tests are ok to skip IFF no changes to BaseStrategy are made
    xit('should not allow implementation upgrades without initiating cooldown', async function () {
      const {strategy} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const StrategyV2 = await ethers.getContractFactory('TestReaperStrategyTombMaiV2');
      await expect(upgrades.upgradeProxy(strategy.address, StrategyV2)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );
    });

    xit('should not allow implementation upgrades before timelock has passed', async function () {
      const {strategy} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await strategy.initiateUpgradeCooldown();

      const StrategyV2 = await ethers.getContractFactory('TestReaperStrategyTombMaiV3');
      await expect(upgrades.upgradeProxy(strategy.address, StrategyV2)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );
    });

    xit('should allow implementation upgrades once timelock has passed', async function () {
      const {strategy} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const StrategyV2 = await ethers.getContractFactory('TestReaperStrategyTombMaiV2');
      const timeToSkip = (await strategy.UPGRADE_TIMELOCK()).add(10);
      await strategy.initiateUpgradeCooldown();
      await moveTimeForward(timeToSkip.toNumber());
      await upgrades.upgradeProxy(strategy.address, StrategyV2);
    });

    xit('successive upgrades need to initiate timelock again', async function () {
      const {strategy} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const StrategyV2 = await ethers.getContractFactory('TestReaperStrategyTombMaiV2');
      const timeToSkip = (await strategy.UPGRADE_TIMELOCK()).add(10);
      await strategy.initiateUpgradeCooldown();
      await moveTimeForward(timeToSkip.toNumber());
      await upgrades.upgradeProxy(strategy.address, StrategyV2);

      const StrategyV3 = await ethers.getContractFactory('TestReaperStrategyTombMaiV3');
      await expect(upgrades.upgradeProxy(strategy.address, StrategyV3)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );

      await strategy.initiateUpgradeCooldown();
      await expect(upgrades.upgradeProxy(strategy.address, StrategyV3)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );

      await moveTimeForward(timeToSkip.toNumber());
      await upgrades.upgradeProxy(strategy.address, StrategyV3);
    });
  });

  describe('Strategy access control tests', function () {
    it('unassignedRole has no privileges', async function () {
      const {strategy, unassignedRole} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await expect(strategy.connect(unassignedRole).initiateUpgradeCooldown()).to.be.reverted;

      await expect(strategy.connect(unassignedRole).setEmergencyExit()).to.be.reverted;
    });

    it('strategist has right privileges', async function () {
      const {strategy, strategist} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await expect(strategy.connect(strategist).initiateUpgradeCooldown()).to.not.be.reverted;

      await expect(strategy.connect(strategist).setEmergencyExit()).to.be.reverted;
    });

    it('guardian has right privileges', async function () {
      const {strategy, strategist, guardian} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const tx = await strategist.sendTransaction({
        to: guardianAddress,
        value: ethers.utils.parseEther('0.1'),
      });
      await tx.wait();

      await expect(strategy.connect(guardian).initiateUpgradeCooldown()).to.not.be.reverted;

      await expect(strategy.connect(guardian).setEmergencyExit()).to.not.be.reverted;
    });

    it('admin has right privileges', async function () {
      const {strategy, strategist, admin} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const tx = await strategist.sendTransaction({
        to: adminAddress,
        value: ethers.utils.parseEther('0.1'),
      });
      await tx.wait();

      await expect(strategy.connect(admin).initiateUpgradeCooldown()).to.not.be.reverted;

      await expect(strategy.connect(admin).setEmergencyExit()).to.not.be.reverted;
    });

    it('super-admin/owner has right privileges', async function () {
      const {strategy, strategist, superAdmin} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const tx = await strategist.sendTransaction({
        to: superAdminAddress,
        value: ethers.utils.parseEther('0.1'),
      });
      await tx.wait();

      await expect(strategy.connect(superAdmin).initiateUpgradeCooldown()).to.not.be.reverted;

      await expect(strategy.connect(superAdmin).setEmergencyExit()).to.not.be.reverted;
    });
  });

  describe('Vault Access control tests', function () {
    it('unassignedRole has no privileges', async function () {
      const {vault, strategy, unassignedRole} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await expect(vault.connect(unassignedRole).addStrategy(strategy.address, 1000, 1000)).to.be.reverted;

      await expect(vault.connect(unassignedRole).updateStrategyAllocBPS(strategy.address, 1000)).to.be.reverted;

      await expect(vault.connect(unassignedRole).revokeStrategy(strategy.address)).to.be.reverted;

      await expect(vault.connect(unassignedRole).setEmergencyShutdown(true)).to.be.reverted;
    });

    it('strategist has right privileges', async function () {
      const {vault, strategy, strategist} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await expect(vault.connect(strategist).addStrategy(strategy.address, 1000, 1000)).to.be.reverted;

      await vault.connect(strategist).updateStrategyAllocBPS(strategy.address, 1000);

      await expect(vault.connect(strategist).revokeStrategy(strategy.address)).to.be.reverted;

      await expect(vault.connect(strategist).setEmergencyShutdown(true)).to.be.reverted;
    });

    it('guardian has right privileges', async function () {
      const {vault, strategy, owner, guardian} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const tx = await owner.sendTransaction({
        to: guardianAddress,
        value: ethers.utils.parseEther('0.1'),
      });
      await tx.wait();

      await expect(vault.connect(guardian).addStrategy(strategy.address, 1000, 1000)).to.be.reverted;

      await expect(vault.connect(guardian).updateStrategyAllocBPS(strategy.address, 1000)).to.not.be.reverted;

      await expect(vault.connect(guardian).revokeStrategy(strategy.address)).to.not.be.reverted;

      await expect(vault.connect(guardian).setEmergencyShutdown(true)).to.not.be.reverted;

      await expect(vault.connect(guardian).setEmergencyShutdown(false)).to.be.reverted;

      await expect(vault.connect(guardian).removeTvlCap()).to.be.reverted;
    });

    it('admin has right privileges', async function () {
      const {vault, strategy, owner, admin} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await owner.sendTransaction({
        to: adminAddress,
        value: ethers.utils.parseEther('0.1'),
      });
      await expect(vault.connect(admin).addStrategy(strategy.address, 1000, 1000)).to.be.reverted;

      await vault.connect(admin).removeTvlCap();

      await expect(vault.connect(admin).updateStrategyAllocBPS(strategy.address, 1000)).to.not.be.reverted;

      await expect(vault.connect(admin).revokeStrategy(strategy.address)).to.not.be.reverted;

      await expect(vault.connect(admin).setEmergencyShutdown(true)).to.not.be.reverted;

      await vault.connect(admin).setEmergencyShutdown(false);
    });

    it('superAdmin has right privileges', async function () {
      const {vault, owner, superAdmin} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await owner.sendTransaction({
        to: superAdminAddress,
        value: ethers.utils.parseEther('0.1'),
      });
      const Strategy = await ethers.getContractFactory('ReaperStrategyGranarySupplyOnly');
      const strategy = await upgrades.deployProxy(Strategy, [vault.address, strategists, multisigRoles, gWantAddress], {
        kind: 'uups',
      });
      await strategy.deployed();
      await expect(vault.connect(superAdmin).addStrategy(strategy.address, 1000, 1000)).to.not.be.reverted;

      await expect(vault.connect(superAdmin).updateStrategyAllocBPS(strategy.address, 1000)).to.not.be.reverted;

      await expect(vault.connect(superAdmin).revokeStrategy(strategy.address)).to.not.be.reverted;

      await expect(vault.connect(superAdmin).setEmergencyShutdown(true)).to.not.be.reverted;
    });
  });

  describe('Vault Tests', function () {
    it('should allow deposits and account for them correctly', async function () {
      const {vault, strategy, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const depositAmount = toWantUnit('10');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      const newVaultBalance = await vault.totalAssets();
      const allowedInaccuracy = depositAmount.div(200);
      expect(depositAmount).to.be.closeTo(newVaultBalance, allowedInaccuracy);
    });

    it('should mint user their pool share', async function () {
      const {vault, strategy, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const depositAmount = toWantUnit('10');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      const ownerDepositAmount = toWantUnit('0.1');
      await want.connect(wantHolder).transfer(owner.address, ownerDepositAmount);
      await want.connect(owner).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(owner)['deposit(uint256)'](ownerDepositAmount);

      const allowedImprecision = toWantUnit('0.0001');

      const userVaultBalance = await vault.balanceOf(wantHolderAddr);
      expect(userVaultBalance).to.be.closeTo(depositAmount, allowedImprecision);
      const ownerVaultBalance = await vault.balanceOf(owner.address);
      expect(ownerVaultBalance).to.be.closeTo(ownerDepositAmount, allowedImprecision);

      await vault.connect(owner).withdrawAll();
      const ownerWantBalance = await want.balanceOf(owner.address);
      expect(ownerWantBalance).to.be.closeTo(ownerDepositAmount, allowedImprecision);
      const afterOwnerVaultBalance = await vault.balanceOf(owner.address);
      expect(afterOwnerVaultBalance).to.equal(0);
    });

    it('should allow withdrawals', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const userBalance = await want.balanceOf(wantHolderAddr);
      const depositAmount = toWantUnit('10');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      await vault.connect(wantHolder).withdrawAll();
      const userBalanceAfterWithdraw = await want.balanceOf(wantHolderAddr);

      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = depositAmount.mul(securityFee).div(percentDivisor);
      const expectedBalance = userBalance.sub(withdrawFee);
      const smallDifference = expectedBalance.div(200);
      const isSmallBalanceDifference = expectedBalance.sub(userBalanceAfterWithdraw) < smallDifference;
      expect(isSmallBalanceDifference).to.equal(true);
    });

    it('should allow small withdrawal', async function () {
      const {vault, strategy, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const userBalance = await want.balanceOf(wantHolderAddr);
      const depositAmount = toWantUnit('0.0000001');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      const ownerDepositAmount = toWantUnit('0.1');
      await want.connect(wantHolder).transfer(owner.address, ownerDepositAmount);
      await want.connect(owner).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(owner)['deposit(uint256)'](ownerDepositAmount);

      await vault.connect(wantHolder).withdrawAll();
      const userBalanceAfterWithdraw = await want.balanceOf(wantHolderAddr);

      const expectedBalance = userBalance;
      const smallDifference = expectedBalance.div(200);
      const isSmallBalanceDifference = expectedBalance.sub(userBalanceAfterWithdraw) < smallDifference;
      expect(isSmallBalanceDifference).to.equal(true);
    });

    it('should handle small deposit + withdraw', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const userBalance = await want.balanceOf(wantHolderAddr);
      const depositAmount = toWantUnit('0.00001');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      await vault.connect(wantHolder)['withdraw(uint256)'](depositAmount);
      const userBalanceAfterWithdraw = await want.balanceOf(wantHolderAddr);

      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = (depositAmount * securityFee) / percentDivisor;
      const expectedBalance = userBalance.sub(withdrawFee);
      const isSmallBalanceDifference = expectedBalance.sub(userBalanceAfterWithdraw) < 200;
      expect(isSmallBalanceDifference).to.equal(true);
    });

    it('should lock profits from harvests', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const initialUserBalance = await want.balanceOf(wantHolderAddr);
      const depositAmount = initialUserBalance.div(5);
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest(); // to get user deposit flowing into strategy

      const initialVaultBalance = await vault.balance();
      const initialLockedProfit = await vault.lockedProfit();
      expect(initialVaultBalance).to.equal(depositAmount);
      expect(initialLockedProfit).to.equal(0);

      const timeToSkip = 3600;
      await moveTimeForward(timeToSkip * 24);
      await strategy.harvest();

      const postHarvestVaultBalance = await vault.balance();
      const postHarvestLockedProfit = await vault.lockedProfit();
      expect(postHarvestVaultBalance).to.be.gt(initialVaultBalance);
      expect(postHarvestLockedProfit).to.be.gt(0);

      // unlocked profit keeps going down with time
      let vaultTotalSupply = await vault.totalSupply();
      for (let i = 0; i < 5; i++) {
        const unlockedAssetsBefore = await vault.convertToAssets(vaultTotalSupply);
        await moveTimeForward(timeToSkip);
        const unlockedAssetsAfter = await vault.convertToAssets(vaultTotalSupply);
        expect(unlockedAssetsAfter).to.be.gt(unlockedAssetsBefore);
      }

      // setting degradation to 1e18 releases unlocked profit
      await vault.setLockedProfitDegradation(ethers.utils.parseEther('1'));
      const unlockedAssets = await vault.convertToAssets(vaultTotalSupply);
      expect(unlockedAssets).to.equal(postHarvestVaultBalance);

      // one last harvest to verify all locked profit gets released
      await moveTimeForward(timeToSkip);
      await strategy.harvest();
      await moveTimeForward(timeToSkip);
      vaultTotalSupply = await vault.totalSupply();

      const finalVaultBalance = await vault.balance();
      const finalUnlockedAssets = await vault.convertToAssets(vaultTotalSupply);
      expect(finalUnlockedAssets).to.equal(finalVaultBalance);
    });

    it('should issue vault shares as fees on harvests', async function () {
      const {vault, strategy, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const depositAmount = toWantUnit('10');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      const timeToSkip = 3600 * 24;
      await moveTimeForward(timeToSkip);

      let treasuryVaultBal = await vault.balanceOf(treasuryAddr);
      expect(treasuryVaultBal).to.equal(0);

      const readOnlyStrat = await strategy.connect(ethers.provider);
      const predictedProfit = await readOnlyStrat.callStatic.harvest();
      const predictedFee = predictedProfit.mul(1000).div(10_000); // fee is 10%

      await strategy.harvest();
      treasuryVaultBal = await vault.balanceOf(treasuryAddr);
      expect(treasuryVaultBal).to.be.gt(0);

      const ppfs = await vault.getPricePerFullShare();
      const decimals = await vault.decimals();
      const treasurySharesValue = ppfs.mul(treasuryVaultBal).div(ethers.BigNumber.from(10).pow(decimals));
      expect(treasurySharesValue).to.be.closeTo(predictedFee, predictedFee.div(10));
    });
  });

  describe('ERC4626 compliance', function () {
    it('should be able to convert assets in to amount of shares', async function () {
      const {vault, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const depositAmount = toWantUnit('10');
      let shares = await vault.connect(wantHolder).convertToShares(depositAmount);
      expect(shares).to.equal(depositAmount);
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);

      let totalAssets = await vault.totalAssets();
      console.log(`totalAssets: ${totalAssets}`);
      // Modify the price per share to not be 1 to 1
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('2'));
      totalAssets = await vault.totalAssets();
      console.log(`totalAssets: ${totalAssets}`);

      await want.connect(wantHolder).transfer(owner.address, depositAmount);
      await want.connect(owner).approve(vault.address, ethers.constants.MaxUint256);
      shares = await vault.connect(owner).convertToShares(depositAmount);
      await vault.connect(owner)['deposit(uint256,address)'](depositAmount, owner.address);
      console.log(`shares: ${shares}`);

      const vaultBalance = await vault.balanceOf(owner.address);
      console.log(`vaultBalance: ${vaultBalance}`);
      expect(shares).to.equal(vaultBalance);
    });

    it('should be able to convert shares in to amount of assets', async function () {
      const {vault, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const shareAmount = toWantUnit('10');
      let assets = await vault.convertToAssets(shareAmount);
      expect(assets).to.equal(shareAmount);
      console.log(`assets: ${assets}`);

      const depositAmount = toWantUnit('2');
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      await want.connect(wantHolder).transfer(vault.address, depositAmount);

      assets = await vault.convertToAssets(shareAmount);
      console.log(`assets: ${assets}`);
      expect(assets).to.equal(shareAmount.mul(2));
    });

    it('maxDeposit returns the maximum amount of assets that can be deposited', async function () {
      const {vault, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // no tvlCap initially
      let maxDeposit = await vault.maxDeposit(wantHolderAddr);
      expect(maxDeposit).to.equal(ethers.BigNumber.from(2).pow(256).sub(1));

      let tvlCap = toWantUnit('75');
      await vault.updateTvlCap(tvlCap);
      maxDeposit = await vault.maxDeposit(wantHolderAddr);
      expect(maxDeposit).to.equal(tvlCap);

      const depositAmount = toWantUnit('2');
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      maxDeposit = await vault.maxDeposit(wantHolderAddr);
      expect(maxDeposit).to.equal(tvlCap.sub(depositAmount));

      tvlCap = toWantUnit('1');
      await vault.updateTvlCap(tvlCap);
      maxDeposit = await vault.maxDeposit(wantHolderAddr);
      expect(maxDeposit).to.equal(0);

      tvlCap = toWantUnit('100');
      await vault.updateTvlCap(tvlCap);
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      maxDeposit = await vault.maxDeposit(wantHolderAddr);
      expect(maxDeposit).to.equal(toWantUnit('96'));

      // set emergencyShutdown
      await vault.setEmergencyShutdown(true);
      maxDeposit = await vault.maxDeposit(wantHolderAddr);
      expect(maxDeposit).to.equal(0);
    });

    it('previewDeposit returns the number of shares that would be minted on deposit', async function () {
      const {vault, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const depositAmount = toWantUnit('10');
      let previewShares = await vault.previewDeposit(depositAmount);
      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesMinted = userSharesAfter.sub(userSharesBefore);
      expect(userSharesMinted).to.equal(previewShares);

      // change price per share
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('7'));

      // owner is now going to deposit
      const ownerDepositAmount = toWantUnit('3');
      await want.connect(wantHolder).transfer(owner.address, ownerDepositAmount);
      await want.connect(owner).approve(vault.address, ethers.constants.MaxUint256);

      previewShares = await vault.previewDeposit(ownerDepositAmount);
      const ownerSharesBefore = await vault.balanceOf(owner.address);
      await vault.connect(owner)['deposit(uint256,address)'](ownerDepositAmount, owner.address);
      const ownerSharesAfter = await vault.balanceOf(owner.address);
      const ownerSharesMinted = ownerSharesAfter.sub(ownerSharesBefore);
      expect(ownerSharesMinted).to.equal(previewShares);
    });

    it('4626 deposit for self issues shares to self and emits Deposit event', async function () {
      const {vault, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      const depositAmount = toWantUnit('10');
      await expect(vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr))
        .to.emit(vault, 'Deposit')
        .withArgs(wantHolderAddr, wantHolderAddr, toWantUnit('10'), toWantUnit('10'));
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesMinted = userSharesAfter.sub(userSharesBefore);
      expect(userSharesMinted).to.equal(toWantUnit('10'));
    });

    it('4626 deposit for other issues shares to other and emits Deposit event', async function () {
      const {vault, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // have wantHolder first deposit for self
      await vault.connect(wantHolder)['deposit(uint256,address)'](toWantUnit('5'), wantHolderAddr);

      // send some assets to change share price
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('5'));
      // new share price is 2.0

      const ownerSharesBefore = await vault.balanceOf(owner.address);
      const depositAmount = toWantUnit('6');
      await expect(vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, owner.address))
        .to.emit(vault, 'Deposit')
        .withArgs(wantHolderAddr, owner.address, depositAmount, toWantUnit('3'));
      const ownerSharesAfter = await vault.balanceOf(owner.address);
      const ownerSharesMinted = ownerSharesAfter.sub(ownerSharesBefore);
      expect(ownerSharesMinted).to.equal(toWantUnit('3'));
    });

    it('maxMint returns the maximum amount of shares that can be deposited', async function () {
      const {vault, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // no tvlCap initially
      let maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(ethers.BigNumber.from(2).pow(256).sub(1));

      let tvlCap = toWantUnit('77');
      await vault.updateTvlCap(tvlCap);
      maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(tvlCap); // since share price is 1:1 initially

      const depositAmount = toWantUnit('4');
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(tvlCap.sub(depositAmount)); // since share price is still 1:1

      // send some assets to change share price
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('12'));
      // new assets = 4 + 12 = 16
      // total shares is still 4
      // so new share price is 16 / 4 = 4
      // deposit room left is 77 - 16 = 61

      maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(toWantUnit('15.25')); // since share price is now 4

      // set emergencyShutdown
      await vault.setEmergencyShutdown(true);
      maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(0);

      // undo emergencyShutdown
      await vault.setEmergencyShutdown(false);
      maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(toWantUnit('15.25'));

      tvlCap = toWantUnit('1');
      await vault.updateTvlCap(tvlCap);
      maxMint = await vault.maxMint(wantHolderAddr);
      expect(maxMint).to.equal(0);
    });

    it('previewMint returns the amount of asset taken on a mint', async function () {
      const {vault, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      let mintAmount = toWantUnit('5');
      let mintPreview = await vault.connect(wantHolder).previewMint(mintAmount);
      expect(mintPreview).to.equal(mintAmount);

      let userBalance = await want.balanceOf(wantHolderAddr);
      await vault.connect(wantHolder).mint(mintAmount, wantHolderAddr);
      let userBalanceAfterMint = await want.balanceOf(wantHolderAddr);
      expect(userBalanceAfterMint).to.equal(userBalance.sub(mintPreview));

      // Change the price per share
      // assets = 5 + 2 = 7
      // shares = 5
      // share price = 7 / 5 = 1.4
      const transferAmount = toWantUnit('2');
      await want.connect(wantHolder).transfer(vault.address, transferAmount);

      mintAmount = toWantUnit('3');
      mintPreview = await vault.connect(wantHolder).previewMint(mintAmount);
      expect(mintPreview).to.equal(toWantUnit('4.2'));
      userBalance = await want.balanceOf(wantHolderAddr);
      await vault.connect(wantHolder).mint(mintAmount, wantHolderAddr);
      userBalanceAfterMint = await want.balanceOf(wantHolderAddr);
      expect(userBalanceAfterMint).to.equal(userBalance.sub(mintPreview));
    });

    it('4626 mint for self issues shares to self and emits Deposit event', async function () {
      const {vault, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      const mintAmount = toWantUnit('10');
      await expect(vault.connect(wantHolder).mint(mintAmount, wantHolderAddr))
        .to.emit(vault, 'Deposit')
        .withArgs(wantHolderAddr, wantHolderAddr, toWantUnit('10'), toWantUnit('10'));
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesMinted = userSharesAfter.sub(userSharesBefore);
      expect(userSharesMinted).to.equal(toWantUnit('10'));
    });

    it('4626 mint for other issues shares to other and emits Deposit event', async function () {
      const {vault, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // have wantHolder first mint for self
      await vault.connect(wantHolder).mint(toWantUnit('5'), wantHolderAddr);

      // send some assets to change share price
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('5'));
      // new share price is 2.0

      const ownerSharesBefore = await vault.balanceOf(owner.address);
      const mintAmount = toWantUnit('3');
      await expect(vault.connect(wantHolder).mint(mintAmount, owner.address))
        .to.emit(vault, 'Deposit')
        .withArgs(wantHolderAddr, owner.address, toWantUnit('6'), mintAmount);
      const ownerSharesAfter = await vault.balanceOf(owner.address);
      const ownerSharesMinted = ownerSharesAfter.sub(ownerSharesBefore);
      expect(ownerSharesMinted).to.equal(mintAmount);
    });

    it('maxWithdraw returns the maximum amount of assets that can be withdrawn', async function () {
      const {vault, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // no deposits initially
      let maxWithdraw = await vault.maxWithdraw(wantHolderAddr);
      expect(maxWithdraw).to.equal(0);

      // deposit some for self
      const depositAmount = toWantUnit('4');
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      maxWithdraw = await vault.maxWithdraw(wantHolderAddr);
      expect(maxWithdraw).to.equal(toWantUnit('4'));

      // send some assets to change share price
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('12'));
      // new assets = 4 + 12 = 16
      // total shares is still 4
      // so new share price is 16 / 4 = 4
      maxWithdraw = await vault.maxWithdraw(wantHolderAddr);
      expect(maxWithdraw).to.equal(toWantUnit('16')); // 4 shares * 4 ppfs

      // mint some for owner
      const mintAmount = toWantUnit('1');
      await vault.connect(wantHolder).mint(mintAmount, owner.address);
      maxWithdraw = await vault.maxWithdraw(wantHolderAddr);
      expect(maxWithdraw).to.equal(toWantUnit('16')); // 4 shares * 4 ppfs
      maxWithdraw = await vault.maxWithdraw(owner.address);
      expect(maxWithdraw).to.equal(toWantUnit('4')); // 1 share * 4 ppfs
    });

    it('previewWithdraw returns the amount of shares burned on withdraw', async function () {
      const {vault, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      let withdrawAmount = toWantUnit('5');
      let withdrawPreview = await vault.connect(wantHolder).previewWithdraw(withdrawAmount);
      expect(withdrawPreview).to.equal(0);

      await vault.connect(wantHolder)['deposit(uint256,address)'](withdrawAmount, wantHolderAddr);
      withdrawPreview = await vault.connect(wantHolder).previewWithdraw(withdrawAmount);
      expect(withdrawPreview).to.equal(withdrawAmount); // since share price is 1

      // Change the price per share
      // assets = 5 + 2 = 7
      // shares = 5
      // share price = 7 / 5 = 1.4
      const transferAmount = toWantUnit('2');
      await want.connect(wantHolder).transfer(vault.address, transferAmount);

      withdrawAmount = toWantUnit('7');
      withdrawPreview = await vault.connect(wantHolder).previewWithdraw(withdrawAmount);
      expect(withdrawPreview).to.equal(toWantUnit('5'));

      const userVaultBalance = await vault.balanceOf(wantHolderAddr);
      await vault
        .connect(wantHolder)
        ['withdraw(uint256,address,address)'](withdrawAmount, wantHolderAddr, wantHolderAddr);
      const userVaultBalanceAfterWithdraw = await vault.balanceOf(wantHolderAddr);
      expect(userVaultBalanceAfterWithdraw).to.equal(userVaultBalance.sub(toWantUnit('5')));
    });

    it('4626 withdraw to self emits withdraw event', async function () {
      const {vault, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // first mint to self
      const mintAmount = toWantUnit('10');
      await vault.connect(wantHolder).mint(mintAmount, wantHolderAddr);

      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      await expect(
        vault.connect(wantHolder)['withdraw(uint256,address,address)'](mintAmount, wantHolderAddr, wantHolderAddr),
      )
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, wantHolderAddr, wantHolderAddr, mintAmount, mintAmount);
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesBurned = userSharesBefore.sub(userSharesAfter);
      expect(userSharesBurned).to.equal(mintAmount);

      // then try minting to other and withdrawing without allowance (should revert)
      await vault.connect(wantHolder).mint(mintAmount, owner.address);

      await expect(
        vault.connect(wantHolder)['withdraw(uint256,address,address)'](mintAmount, wantHolderAddr, owner.address),
      ).to.be.reverted;

      // have owner give allowance and then try withdrawing, shouldn't revert
      await vault.connect(owner).approve(wantHolderAddr, mintAmount);
      await expect(
        vault.connect(wantHolder)['withdraw(uint256,address,address)'](mintAmount, wantHolderAddr, owner.address),
      )
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, wantHolderAddr, owner.address, mintAmount, mintAmount);
    });

    it('4626 withdraw to other emits withdraw event', async function () {
      const {vault, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // first mint to self
      const mintAmount = toWantUnit('10');
      await vault.connect(wantHolder).mint(mintAmount, wantHolderAddr);

      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      await expect(
        vault.connect(wantHolder)['withdraw(uint256,address,address)'](mintAmount, owner.address, wantHolderAddr),
      )
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, owner.address, wantHolderAddr, mintAmount, mintAmount);
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesBurned = userSharesBefore.sub(userSharesAfter);
      expect(userSharesBurned).to.equal(mintAmount);

      // then try minting to other and withdrawing to other without allowance (should revert)
      await vault.connect(wantHolder).mint(mintAmount, owner.address);

      await expect(
        vault.connect(wantHolder)['withdraw(uint256,address,address)'](mintAmount, owner.address, owner.address),
      ).to.be.reverted;

      // have owner give allowance and then try withdrawing to owner, shouldn't revert
      await vault.connect(owner).approve(wantHolderAddr, mintAmount);
      await expect(
        vault.connect(wantHolder)['withdraw(uint256,address,address)'](mintAmount, owner.address, owner.address),
      )
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, owner.address, owner.address, mintAmount, mintAmount);
    });

    it('maxRedeem returns the max number of shares that can be redeemed for user', async function () {
      const {vault, want, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // no deposits initially
      let maxRedeem = await vault.maxRedeem(wantHolderAddr);
      expect(maxRedeem).to.equal(0);

      // deposit some for self
      const depositAmount = toWantUnit('4');
      await vault.connect(wantHolder)['deposit(uint256,address)'](depositAmount, wantHolderAddr);
      maxRedeem = await vault.maxRedeem(wantHolderAddr);
      expect(maxRedeem).to.equal(toWantUnit('4'));

      // send some assets to change share price
      await want.connect(wantHolder).transfer(vault.address, toWantUnit('12'));
      // new assets = 4 + 12 = 16
      // total shares is still 4
      // so new share price is 16 / 4 = 4
      // but number of shares doesn't change
      maxRedeem = await vault.maxRedeem(wantHolderAddr);
      expect(maxRedeem).to.equal(toWantUnit('4')); // still 4 shares

      // mint some for owner
      const mintAmount = toWantUnit('1');
      await vault.connect(wantHolder).mint(mintAmount, owner.address);
      maxRedeem = await vault.maxRedeem(wantHolderAddr);
      expect(maxRedeem).to.equal(toWantUnit('4'));
      maxRedeem = await vault.maxRedeem(owner.address);
      expect(maxRedeem).to.equal(toWantUnit('1'));
    });

    it('previewRedeem returns the amount of assets returned on redeem', async function () {
      const {vault, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      let redeemAmount = toWantUnit('5');
      let redeemPreview = await vault.connect(wantHolder).previewRedeem(redeemAmount);
      expect(redeemPreview).to.equal(redeemAmount);

      await vault.connect(wantHolder).mint(redeemAmount, wantHolderAddr);
      redeemPreview = await vault.connect(wantHolder).previewRedeem(redeemAmount);
      expect(redeemPreview).to.equal(redeemAmount); // since share price is 1

      // Change the price per share
      // assets = 5 + 2 = 7
      // shares = 5
      // share price = 7 / 5 = 1.4
      const transferAmount = toWantUnit('2');
      await want.connect(wantHolder).transfer(vault.address, transferAmount);

      redeemAmount = toWantUnit('5');
      redeemPreview = await vault.connect(wantHolder).previewRedeem(redeemAmount);
      expect(redeemPreview).to.equal(toWantUnit('7')); // 5 shares * 1.4 ppfs

      const userBalance = await want.balanceOf(wantHolderAddr);
      await vault.connect(wantHolder).redeem(redeemAmount, wantHolderAddr, wantHolderAddr);
      const userBalanceAfterRedeem = await want.balanceOf(wantHolderAddr);
      expect(userBalanceAfterRedeem).to.equal(userBalance.add(toWantUnit('7')));
    });

    it('4626 redeem to self emits withdraw event', async function () {
      const {vault, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // first mint to self
      const mintAmount = toWantUnit('10');
      await vault.connect(wantHolder).mint(mintAmount, wantHolderAddr);

      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      await expect(vault.connect(wantHolder).redeem(mintAmount, wantHolderAddr, wantHolderAddr))
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, wantHolderAddr, wantHolderAddr, mintAmount, mintAmount);
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesBurned = userSharesBefore.sub(userSharesAfter);
      expect(userSharesBurned).to.equal(mintAmount);

      // then try minting to other and redeeming without allowance (should revert)
      await vault.connect(wantHolder).mint(mintAmount, owner.address);

      await expect(vault.connect(wantHolder).redeem(mintAmount, wantHolderAddr, owner.address)).to.be.reverted;

      // have owner give allowance and then try redeeming, shouldn't revert
      await vault.connect(owner).approve(wantHolderAddr, mintAmount);
      await expect(vault.connect(wantHolder).redeem(mintAmount, wantHolderAddr, owner.address))
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, wantHolderAddr, owner.address, mintAmount, mintAmount);
    });

    it('4626 redeem to other emits withdraw event', async function () {
      const {vault, wantHolder, owner} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      // first mint to self
      const mintAmount = toWantUnit('10');
      await vault.connect(wantHolder).mint(mintAmount, wantHolderAddr);

      const userSharesBefore = await vault.balanceOf(wantHolderAddr);
      await expect(vault.connect(wantHolder).redeem(mintAmount, owner.address, wantHolderAddr))
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, owner.address, wantHolderAddr, mintAmount, mintAmount);
      const userSharesAfter = await vault.balanceOf(wantHolderAddr);
      const userSharesBurned = userSharesBefore.sub(userSharesAfter);
      expect(userSharesBurned).to.equal(mintAmount);

      // then try minting to other and redeeming to other without allowance (should revert)
      await vault.connect(wantHolder).mint(mintAmount, owner.address);

      await expect(vault.connect(wantHolder).redeem(mintAmount, owner.address, owner.address)).to.be.reverted;

      // have owner give allowance and then try redeeming to owner, shouldn't revert
      await vault.connect(owner).approve(wantHolderAddr, mintAmount);
      await expect(vault.connect(wantHolder).redeem(mintAmount, owner.address, owner.address))
        .to.emit(vault, 'Withdraw')
        .withArgs(wantHolderAddr, owner.address, owner.address, mintAmount, mintAmount);
    });
  });

  describe('Strategy', function () {
    it('should be able to harvest', async function () {
      const {vault, strategy, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const depositAmount = toWantUnit('10');
      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();

      await moveTimeForward(3600 * 24);
      const readOnlyStrat = await strategy.connect(ethers.provider);
      const predictedProfit = await readOnlyStrat.callStatic.harvest();
      console.log(`predicted profit ${ethers.utils.formatUnits(predictedProfit, 8)}`);
      await strategy.harvest();

      const vaultBalance = await vault.balance();
      expect(vaultBalance).to.be.closeTo(predictedProfit.add(depositAmount), predictedProfit.div(10));
    });

    it('should provide yield', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      const timeToSkip = 3600;
      const initialUserBalance = await want.balanceOf(wantHolderAddr);
      const depositAmount = initialUserBalance.div(10);

      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();
      const initialVaultBalance = await vault.totalAssets();

      const numHarvests = 5;
      for (let i = 0; i < numHarvests; i++) {
        await moveTimeForward(timeToSkip);
        await strategy.harvest();
      }

      const finalVaultBalance = await vault.totalAssets();
      expect(finalVaultBalance).to.be.gt(initialVaultBalance);
    });

    it('should provide yield, with OATH emissions', async function () {
      const {vault, strategy, want, owner, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);

      // set OATH->WBTC swap path
      const oathAddress = '0x39FdE572a18448F8139b7788099F0a0740f51205';
      const usdcAddress = '0x7F5c764cBc14f9669B88837ca1490cCa17c31607';
      await strategy
        .connect(owner)
        .updateVeloSwapPath(oathAddress, wantAddress, [oathAddress, usdcAddress, wantAddress]);
      // add harvest step to swap OATH->WBTC
      await strategy.connect(owner).setHarvestSteps([[oathAddress, wantAddress]]);

      const oathHolderAddress = '0x8B4441E79151e3fC5264733A3C5da4fF8EAc16c1';
      const oathHolder = await ethers.getImpersonatedSigner(oathHolderAddress);
      const oath = want.attach(oathAddress);

      const timeToSkip = 3600;
      const initialUserBalance = await want.balanceOf(wantHolderAddr);
      const depositAmount = initialUserBalance.div(10);

      await vault.connect(wantHolder)['deposit(uint256)'](depositAmount);
      await strategy.harvest();
      const initialVaultBalance = await vault.totalAssets();

      const numHarvests = 5;
      for (let i = 0; i < numHarvests; i++) {
        // send some OATH directly to strategy
        await oath.connect(oathHolder).transfer(strategy.address, toWantUnit('100', false));
        await moveTimeForward(timeToSkip);
        await strategy.harvest();
      }

      const finalVaultBalance = await vault.totalAssets();
      expect(finalVaultBalance).to.be.gt(initialVaultBalance);

      const roi = finalVaultBalance
        .sub(initialVaultBalance)
        .mul(ethers.BigNumber.from(10_000))
        .div(initialVaultBalance);
      console.log(`ROI BPS ~${roi.toString()}`);
    });
  });

  describe('Vault<>Strat accounting', function () {
    it('Strat gets more money when it flows in', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await vault.connect(wantHolder)['deposit(uint256)'](toWantUnit('5'));
      await strategy.harvest();
      await moveTimeForward(3600);
      let vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('0.5'));
      let stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('4.5'));

      await vault.connect(wantHolder)['deposit(uint256)'](toWantUnit('5'));
      await strategy.harvest();
      await moveTimeForward(3600);
      vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('1'));
      stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('9'));
    });

    it('Vault pulls funds from strat as needed', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await vault.connect(wantHolder)['deposit(uint256)'](toWantUnit('10'));
      await strategy.harvest();
      await moveTimeForward(3600);
      let vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('1'));
      let stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('9'));

      await vault.updateStrategyAllocBPS(strategy.address, 7000);
      await strategy.harvest();
      await moveTimeForward(3600);
      vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('3'));
      stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('7'));

      await vault.connect(wantHolder)['deposit(uint256)'](toWantUnit('1'));
      await strategy.harvest();
      await moveTimeForward(3600);
      vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('3.3'));
      stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('7.7'));
    });
  });

  describe('Emergency scenarios', function () {
    it('Vault should handle emergency shutdown', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await vault.connect(wantHolder)['deposit(uint256)'](toWantUnit('10'));
      await strategy.harvest();
      await moveTimeForward(3600);
      let vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('1'));
      let stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('9'));

      await vault.setEmergencyShutdown(true);
      await strategy.harvest();
      vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('10'));
      stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('0'));
    });

    it('Strategy should handle emergency exit', async function () {
      const {vault, strategy, want, wantHolder} = await loadFixture(deployVaultAndStrategyAndGetSigners);
      await vault.connect(wantHolder)['deposit(uint256)'](toWantUnit('10'));
      await strategy.harvest();
      await moveTimeForward(3600);
      let vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('1'));
      let stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('9'));

      await vault.setEmergencyShutdown(true);
      await strategy.harvest();
      vaultBalance = await want.balanceOf(vault.address);
      expect(vaultBalance).to.be.gte(toWantUnit('10'));
      stratBalance = await strategy.balanceOf();
      expect(stratBalance).to.be.gte(toWantUnit('0'));
    });
  });
});
