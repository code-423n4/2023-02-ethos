// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../Dependencies/SafeMath.sol";
import "../Dependencies/LiquityMath.sol";
import "../Dependencies/IERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ICollateralConfig.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/IStabilityPool.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/ILQTYStaking.sol";
import "./BorrowerOperationsScript.sol";
import "./ERC20TransferScript.sol";
import "./LQTYStakingScript.sol";
import "../Dependencies/console.sol";
import "../Dependencies/SafeERC20.sol";


contract BorrowerWrappersScript is BorrowerOperationsScript, ERC20TransferScript, LQTYStakingScript {
    using SafeMath for uint;
    using SafeERC20 for IERC20;

    string constant public NAME = "BorrowerWrappersScript";

    ICollateralConfig immutable collateralConfig;
    ITroveManager immutable troveManager;
    IStabilityPool immutable stabilityPool;
    IPriceFeed immutable priceFeed;
    IERC20 immutable lusdToken;
    IERC20 immutable lqtyToken;
    ILQTYStaking immutable lqtyStaking;

    constructor(
        address _borrowerOperationsAddress,
        address _collateralConfigAddress,
        address _troveManagerAddress,
        address _lqtyStakingAddress
    )
        BorrowerOperationsScript(IBorrowerOperations(_borrowerOperationsAddress))
        LQTYStakingScript(_lqtyStakingAddress)
        public
    {
        checkContract(_collateralConfigAddress);
        ICollateralConfig collateralConfigCached = ICollateralConfig(_collateralConfigAddress);
        collateralConfig = collateralConfigCached;

        checkContract(_troveManagerAddress);
        ITroveManager troveManagerCached = ITroveManager(_troveManagerAddress);
        troveManager = troveManagerCached;

        IStabilityPool stabilityPoolCached = troveManagerCached.stabilityPool();
        checkContract(address(stabilityPoolCached));
        stabilityPool = stabilityPoolCached;

        IPriceFeed priceFeedCached = troveManagerCached.priceFeed();
        checkContract(address(priceFeedCached));
        priceFeed = priceFeedCached;

        address lusdTokenCached = address(troveManagerCached.lusdToken());
        checkContract(lusdTokenCached);
        lusdToken = IERC20(lusdTokenCached);

        address lqtyTokenCached = address(troveManagerCached.lqtyToken());
        checkContract(lqtyTokenCached);
        lqtyToken = IERC20(lqtyTokenCached);

        ILQTYStaking lqtyStakingCached = troveManagerCached.lqtyStaking();
        require(_lqtyStakingAddress == address(lqtyStakingCached), "BorrowerWrappersScript: Wrong LQTYStaking address");
        lqtyStaking = lqtyStakingCached;
    }

    function claimCollateralAndOpenTrove(address _collateral, uint _collAmount, uint _maxFee, uint _LUSDAmount, address _upperHint, address _lowerHint) external {
        uint balanceBefore = IERC20(_collateral).balanceOf(address(this));

        // Claim collateral
        borrowerOperations.claimCollateral(_collateral);

        uint balanceAfter = IERC20(_collateral).balanceOf(address(this));

        // already checked in CollSurplusPool
        assert(balanceAfter > balanceBefore);

        uint totalCollateral = balanceAfter.sub(balanceBefore).add(_collAmount);

        // Open trove with obtained collateral, plus collateral sent by user
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collAmount);
        IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), totalCollateral);
        borrowerOperations.openTrove(_collateral, totalCollateral, _maxFee, _LUSDAmount, _upperHint, _lowerHint);
    }

    function claimSPRewardsAndRecycle(address _collateral, uint _maxFee, address _upperHint, address _lowerHint) external {
        uint collBalanceBefore = IERC20(_collateral).balanceOf(address(this));
        uint lqtyBalanceBefore = lqtyToken.balanceOf(address(this));

        // Claim rewards
        stabilityPool.withdrawFromSP(0);

        uint collBalanceAfter = IERC20(_collateral).balanceOf(address(this));
        uint lqtyBalanceAfter = lqtyToken.balanceOf(address(this));
        uint claimedCollateral = collBalanceAfter.sub(collBalanceBefore);

        // Add claimed ETH to trove, get more LUSD and stake it into the Stability Pool
        if (claimedCollateral > 0) {
            _requireUserHasTrove(address(this), _collateral);
            uint LUSDAmount = _getNetLUSDAmount(_collateral, claimedCollateral);
            IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), claimedCollateral);
            borrowerOperations.adjustTrove(_collateral, _maxFee, claimedCollateral, 0, LUSDAmount, true, _upperHint, _lowerHint);
            // Provide withdrawn LUSD to Stability Pool
            if (LUSDAmount > 0) {
                stabilityPool.provideToSP(LUSDAmount);
            }
        }

        // Stake claimed LQTY
        uint claimedLQTY = lqtyBalanceAfter.sub(lqtyBalanceBefore);
        if (claimedLQTY > 0) {
            lqtyToken.approve(address(lqtyStaking), claimedLQTY);
            lqtyStaking.stake(claimedLQTY);
        }
    }

    function claimStakingGainsAndRecycle(address _collateral, uint _maxFee, address _upperHint, address _lowerHint) external {
        uint collBalanceBefore = IERC20(_collateral).balanceOf(address(this));
        uint lusdBalanceBefore = lusdToken.balanceOf(address(this));
        uint lqtyBalanceBefore = lqtyToken.balanceOf(address(this));

        // Claim gains
        lqtyStaking.unstake(0);

        uint gainedCollateral = IERC20(_collateral).balanceOf(address(this)).sub(collBalanceBefore); // stack too deep issues :'(
        uint gainedLUSD = lusdToken.balanceOf(address(this)).sub(lusdBalanceBefore);

        uint netLUSDAmount;
        // Top up trove and get more LUSD, keeping ICR constant
        if (gainedCollateral > 0) {
            _requireUserHasTrove(address(this), _collateral);
            netLUSDAmount = _getNetLUSDAmount(_collateral, gainedCollateral);
            IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), gainedCollateral);
            borrowerOperations.adjustTrove(_collateral, _maxFee, gainedCollateral, 0, netLUSDAmount, true, _upperHint, _lowerHint);
        }

        uint totalLUSD = gainedLUSD.add(netLUSDAmount);
        if (totalLUSD > 0) {
            stabilityPool.provideToSP(totalLUSD);

            // Providing to Stability Pool also triggers LQTY claim, so stake it if any
            uint lqtyBalanceAfter = lqtyToken.balanceOf(address(this));
            uint claimedLQTY = lqtyBalanceAfter.sub(lqtyBalanceBefore);
            if (claimedLQTY > 0) {
                lqtyToken.approve(address(lqtyStaking), claimedLQTY);
                lqtyStaking.stake(claimedLQTY);
            }
        }

    }

    function _getNetLUSDAmount(address _collateral, uint _collAmount) internal returns (uint) {
        uint price = priceFeed.fetchPrice(_collateral);
        uint ICR = troveManager.getCurrentICR(address(this), _collateral, price);

        uint collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        uint LUSDAmount = _getScaledCollAmount(_collAmount, collDecimals).mul(price).div(ICR);
        uint borrowingRate = troveManager.getBorrowingRateWithDecay();
        uint netDebt = LUSDAmount.mul(LiquityMath.DECIMAL_PRECISION).div(LiquityMath.DECIMAL_PRECISION.add(borrowingRate));

        return netDebt;
    }

    function _requireUserHasTrove(address _depositor, address _collateral) internal view {
        require(troveManager.getTroveStatus(_depositor, _collateral) == 1, "BorrowerWrappersScript: caller must have an active trove");
    }

    function _getScaledCollAmount(uint256 _collAmount, uint256 _collDecimals) internal pure returns (uint256 scaledColl) {
        scaledColl = _collAmount;
        if (_collDecimals > LiquityMath.CR_CALCULATION_DECIMALS) {
            scaledColl = scaledColl.div(10 ** (_collDecimals - LiquityMath.CR_CALCULATION_DECIMALS));
        } else if (_collDecimals < LiquityMath.CR_CALCULATION_DECIMALS) {
            scaledColl = scaledColl.mul(10 ** (LiquityMath.CR_CALCULATION_DECIMALS - _collDecimals));
        }
    }
}
