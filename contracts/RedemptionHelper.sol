// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "./Interfaces/ICollateralConfig.sol";
import "./Interfaces/ILQTYStaking.sol";
import "./Interfaces/ILUSDToken.sol";
import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/ISortedTroves.sol";
import "./Interfaces/ITroveManager.sol";
import "./Interfaces/IRedemptionHelper.sol";
import "./Dependencies/LiquityBase.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/IERC20.sol";

contract RedemptionHelper is LiquityBase, Ownable, IRedemptionHelper {
    uint constant public BOOTSTRAP_PERIOD = 14 days;

    ITroveManager public troveManager;
    ICollateralConfig public collateralConfig;
    IERC20 public lqtyToken;
    ILUSDToken public lusdToken;
    ISortedTroves public sortedTroves;
    ILQTYStaking public lqtyStaking;

    struct RedemptionTotals {
        uint remainingLUSD;
        uint totalLUSDToRedeem;
        uint totalCollateralDrawn;
        uint collateralFee;
        uint collateralToSendToRedeemer;
        uint decayedBaseRate;
        uint price;
        uint totalLUSDSupplyAtStart;
        uint256 collDecimals;
        uint256 collMCR;
        address currentBorrower;
    }

    struct SingleRedemptionValues {
        uint LUSDLot;
        uint collLot;
        bool cancelledPartial;
    }

    // Due to "stack too deep" error
    struct LocalVariables_redeemCollateralFromTrove {
        uint newDebt;
        uint newColl;
        uint newNICR;
        uint256 collDecimals;
    }

    function setAddresses(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        ITroveManager _troveManager,
        ICollateralConfig _collateralConfig,
        IERC20 _lqtyToken,
        IPriceFeed _priceFeed,
        ILUSDToken _lusdToken,
        ISortedTroves _sortedTroves,
        ILQTYStaking _lqtyStaking
    ) external onlyOwner {
        activePool = _activePool;
        defaultPool = _defaultPool;
        troveManager = _troveManager;
        collateralConfig = _collateralConfig;
        lqtyToken = _lqtyToken;
        priceFeed = _priceFeed;
        lusdToken = _lusdToken;
        sortedTroves = _sortedTroves;
        lqtyStaking = _lqtyStaking;

        _renounceOwnership();
    }

    /* Send _LUSDamount LUSD to the system and redeem the corresponding amount of collateral from as many Troves as are needed to fill the redemption
    * request.  Applies pending rewards to a Trove before reducing its debt and coll.
    *
    * Note that if _amount is very large, this function can run out of gas, specially if traversed troves are small. This can be easily avoided by
    * splitting the total _amount in appropriate chunks and calling the function multiple times.
    *
    * Param `_maxIterations` can also be provided, so the loop through Troves is capped (if it’s zero, it will be ignored).This makes it easier to
    * avoid OOG for the frontend, as only knowing approximately the average cost of an iteration is enough, without needing to know the “topology”
    * of the trove list. It also avoids the need to set the cap in stone in the contract, nor doing gas calculations, as both gas price and opcode
    * costs can vary.
    *
    * All Troves that are redeemed from -- with the likely exception of the last one -- will end up with no debt left, therefore they will be closed.
    * If the last Trove does have some remaining debt, it has a finite ICR, and the reinsertion could be anywhere in the list, therefore it requires a hint.
    * A frontend should use getRedemptionHints() to calculate what the ICR of this Trove will be after redemption, and pass a hint for its position
    * in the sortedTroves list along with the ICR value that the hint was found for.
    *
    * If another transaction modifies the list between calling getRedemptionHints() and passing the hints to redeemCollateral(), it
    * is very likely that the last (partially) redeemed Trove would end up with a different ICR than what the hint is for. In this case the
    * redemption will stop after the last completely redeemed Trove and the sender will keep the remaining LUSD amount, which they can attempt
    * to redeem later.
    */
    function redeemCollateral(
        address _collateral,
        address _redeemer,
        uint _LUSDamount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        uint _maxIterations,
        uint _maxFeePercentage
    )
        external override
    {
        _requireCallerIsTroveManager();
        _requireValidCollateralAddress(_collateral);
        RedemptionTotals memory totals;

        _requireValidMaxFeePercentage(_maxFeePercentage);
        _requireAfterBootstrapPeriod();
        totals.price = priceFeed.fetchPrice(_collateral);
        ICollateralConfig collateralConfigCached = collateralConfig;
        totals.collDecimals = collateralConfigCached.getCollateralDecimals(_collateral);
        totals.collMCR = collateralConfigCached.getCollateralMCR(_collateral);
        _requireTCRoverMCR(_collateral, totals.price, totals.collDecimals, totals.collMCR);
        _requireAmountGreaterThanZero(_LUSDamount);
        _requireLUSDBalanceCoversRedemption(lusdToken, _redeemer, _LUSDamount);

        totals.totalLUSDSupplyAtStart = getEntireSystemDebt(_collateral);
        // Confirm redeemer's balance is less than total LUSD supply
        assert(lusdToken.balanceOf(_redeemer) <= totals.totalLUSDSupplyAtStart);

        totals.remainingLUSD = _LUSDamount;

        ISortedTroves sortedTrovesCached = sortedTroves;
        if (_isValidFirstRedemptionHint(
            sortedTrovesCached,
            _collateral,
            _firstRedemptionHint,
            totals.price,
            totals.collMCR)
        ) {
            totals.currentBorrower = _firstRedemptionHint;
        } else {
            totals.currentBorrower = sortedTrovesCached.getLast(_collateral);
            // Find the first trove with ICR >= MCR
            while (totals.currentBorrower != address(0) &&
                troveManager.getCurrentICR(totals.currentBorrower, _collateral, totals.price) < totals.collMCR) 
            {
                totals.currentBorrower = sortedTrovesCached.getPrev(_collateral, totals.currentBorrower);
            }
        }

        // Loop through the Troves starting from the one with lowest collateral ratio until _amount of LUSD is exchanged for collateral
        if (_maxIterations == 0) { _maxIterations = uint(-1); }
        while (totals.currentBorrower != address(0) && totals.remainingLUSD > 0 && _maxIterations > 0) {
            _maxIterations--;
            // Save the address of the Trove preceding the current one, before potentially modifying the list
            address nextUserToCheck = sortedTrovesCached.getPrev(_collateral, totals.currentBorrower);

            troveManager.applyPendingRewards(totals.currentBorrower, _collateral);

            SingleRedemptionValues memory singleRedemption = _redeemCollateralFromTrove(
                totals.currentBorrower,
                _collateral,
                totals.remainingLUSD,
                totals.price,
                _upperPartialRedemptionHint,
                _lowerPartialRedemptionHint,
                _partialRedemptionHintNICR,
                collateralConfigCached
            );

            if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove

            totals.totalLUSDToRedeem  = totals.totalLUSDToRedeem.add(singleRedemption.LUSDLot);
            totals.totalCollateralDrawn = totals.totalCollateralDrawn.add(singleRedemption.collLot);

            totals.remainingLUSD = totals.remainingLUSD.sub(singleRedemption.LUSDLot);
            totals.currentBorrower = nextUserToCheck;
        }
        require(totals.totalCollateralDrawn > 0);

        // Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
        // Use the saved total LUSD supply value, from before it was reduced by the redemption.
        troveManager.updateBaseRateFromRedemption(
            totals.totalCollateralDrawn,
            totals.price,
            totals.collDecimals,
            totals.totalLUSDSupplyAtStart
        );

        // Calculate the ETH fee
        totals.collateralFee = troveManager.getRedemptionFee(totals.totalCollateralDrawn);

        _requireUserAcceptsFee(totals.collateralFee, totals.totalCollateralDrawn, _maxFeePercentage);

        // Send the collateral fee to the LQTY staking contract
        activePool.sendCollateral(_collateral, address(lqtyStaking), totals.collateralFee);
        lqtyStaking.increaseF_Collateral(_collateral, totals.collateralFee);

        totals.collateralToSendToRedeemer = totals.totalCollateralDrawn.sub(totals.collateralFee);

        // Burn the total LUSD that is cancelled with debt, and send the redeemed collateral to _redeemer
        troveManager.burnLUSDAndEmitRedemptionEvent(
            _redeemer,
            _collateral,
            _LUSDamount,
            totals.totalLUSDToRedeem,
            totals.totalCollateralDrawn,
            totals.collateralFee
        );

        // Update Active Pool LUSD, and send ETH to account
        activePool.decreaseLUSDDebt(_collateral, totals.totalLUSDToRedeem);
        activePool.sendCollateral(_collateral, _redeemer, totals.collateralToSendToRedeemer);
    }

    function _isValidFirstRedemptionHint(
        ISortedTroves _sortedTroves,
        address _collateral,
        address _firstRedemptionHint,
        uint _price,
        uint256 _MCR
    ) internal view returns (bool) {
        if (_firstRedemptionHint == address(0) ||
            !_sortedTroves.contains(_collateral, _firstRedemptionHint) ||
            troveManager.getCurrentICR(_firstRedemptionHint, _collateral, _price) < _MCR
        ) {
            return false;
        }

        address nextTrove = _sortedTroves.getNext(_collateral, _firstRedemptionHint);
        return nextTrove == address(0) || troveManager.getCurrentICR(nextTrove, _collateral, _price) < _MCR;
    }

    // Redeem as much collateral as possible from _borrower's Trove in exchange for LUSD up to _maxLUSDamount
    function _redeemCollateralFromTrove(
        address _borrower,
        address _collateral,
        uint _maxLUSDamount,
        uint _price,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        ICollateralConfig _collateralConfig
    )
        internal returns (SingleRedemptionValues memory singleRedemption)
    {
        // Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
        singleRedemption.LUSDLot = LiquityMath._min(
            _maxLUSDamount,
            troveManager.getTroveDebt(_borrower, _collateral).sub(LUSD_GAS_COMPENSATION)
        );

        LocalVariables_redeemCollateralFromTrove memory vars;
        vars.collDecimals = _collateralConfig.getCollateralDecimals(_collateral);

        // Get the collLot of equivalent value in USD
        singleRedemption.collLot = singleRedemption.LUSDLot.mul(10**vars.collDecimals).div(_price);

        // Decrease the debt and collateral of the current Trove according to the LUSD lot and corresponding collateral to send
        vars.newDebt = troveManager.getTroveDebt(_borrower, _collateral).sub(singleRedemption.LUSDLot);
        vars.newColl = troveManager.getTroveColl(_borrower, _collateral).sub(singleRedemption.collLot);

        if (vars.newDebt == LUSD_GAS_COMPENSATION) {
            // No debt left in the Trove (except for the liquidation reserve), therefore the trove gets closed
            troveManager.removeStake(_borrower, _collateral);
            troveManager.closeTrove(_borrower, _collateral, 4); // 4 = closedByRedemption
            troveManager.redeemCloseTrove(_borrower, _collateral, LUSD_GAS_COMPENSATION, vars.newColl);
        } else {
            vars.newNICR = LiquityMath._computeNominalCR(vars.newColl, vars.newDebt, vars.collDecimals);

            /*
            * If the provided hint is out of date, we bail since trying to reinsert without a good hint will almost
            * certainly result in running out of gas. 
            *
            * If the resultant net debt of the partial is less than the minimum, net debt we bail.
            */
            if (vars.newNICR != _partialRedemptionHintNICR || _getNetDebt(vars.newDebt) < MIN_NET_DEBT) {
                singleRedemption.cancelledPartial = true;
                return singleRedemption;
            }

            troveManager.reInsert(
                _borrower,
                _collateral,
                vars.newNICR,
                _upperPartialRedemptionHint,
                _lowerPartialRedemptionHint
            );
            troveManager.updateDebtAndCollAndStakesPostRedemption(_borrower, _collateral, vars.newDebt, vars.newColl);
        }

        return singleRedemption;
    }

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == address(troveManager), "RedemptionHelper: Caller is not TroveManager");
    }

    function _requireValidCollateralAddress(address _collateral) internal view {
        require(collateralConfig.isCollateralAllowed(_collateral), "Invalid collateral address");
    }

    function _requireValidMaxFeePercentage(uint _maxFeePercentage) internal view {
        require(_maxFeePercentage >= troveManager.REDEMPTION_FEE_FLOOR() && _maxFeePercentage <= DECIMAL_PRECISION);
    }

    function _requireAfterBootstrapPeriod() internal view {
        uint systemDeploymentTime = lusdToken.getDeploymentStartTime();
        require(block.timestamp >= systemDeploymentTime.add(BOOTSTRAP_PERIOD));
    }

    function _requireTCRoverMCR(address _collateral, uint _price, uint256 _collDecimals, uint256 _MCR) internal view {
        require(_getTCR(_collateral, _price, _collDecimals) >= _MCR);
    }

    function _requireAmountGreaterThanZero(uint _amount) internal pure {
        require(_amount > 0);
    }

    function _requireLUSDBalanceCoversRedemption(ILUSDToken _lusdToken, address _redeemer, uint _amount) internal view {
        require(_lusdToken.balanceOf(_redeemer) >= _amount);
    }
}
