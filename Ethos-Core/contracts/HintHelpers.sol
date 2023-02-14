// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "./Interfaces/ICollateralConfig.sol";
import "./Interfaces/ITroveManager.sol";
import "./Interfaces/ISortedTroves.sol";
import "./Dependencies/LiquityBase.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";

contract HintHelpers is LiquityBase, Ownable, CheckContract {
    string constant public NAME = "HintHelpers";

    ICollateralConfig public collateralConfig;
    ISortedTroves public sortedTroves;
    ITroveManager public troveManager;

    // --- Events ---

    event CollateralConfigAddressChanged(address _collateralConfigAddress);
    event SortedTrovesAddressChanged(address _sortedTrovesAddress);
    event TroveManagerAddressChanged(address _troveManagerAddress);

    // --- Dependency setters ---

    function setAddresses(
        address _collateralConfigAddress,
        address _sortedTrovesAddress,
        address _troveManagerAddress
    )
        external
        onlyOwner
    {
        checkContract(_collateralConfigAddress);
        checkContract(_sortedTrovesAddress);
        checkContract(_troveManagerAddress);

        collateralConfig = ICollateralConfig(_collateralConfigAddress);
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
        troveManager = ITroveManager(_troveManagerAddress);

        emit CollateralConfigAddressChanged(_collateralConfigAddress);
        emit SortedTrovesAddressChanged(_sortedTrovesAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);

        _renounceOwnership();
    }

    // --- Functions ---

    /* getRedemptionHints() - Helper function for finding the right hints to pass to redeemCollateral().
     *
     * It simulates a redemption of `_LUSDamount` to figure out where the redemption sequence will start and what state the final Trove
     * of the sequence will end up in.
     *
     * Returns three hints:
     *  - `firstRedemptionHint` is the address of the first Trove with ICR >= MCR (i.e. the first Trove that will be redeemed).
     *  - `partialRedemptionHintNICR` is the final nominal ICR of the last Trove of the sequence after being hit by partial redemption,
     *     or zero in case of no partial redemption.
     *  - `truncatedLUSDamount` is the maximum amount that can be redeemed out of the the provided `_LUSDamount`. This can be lower than
     *    `_LUSDamount` when redeeming the full amount would leave the last Trove of the redemption sequence with less net debt than the
     *    minimum allowed value (i.e. MIN_NET_DEBT).
     *
     * The number of Troves to consider for redemption can be capped by passing a non-zero value as `_maxIterations`, while passing zero
     * will leave it uncapped.
     */

    // Due to "stack too deep" error
    struct LocalVariables_getRedemptionHints {
        uint256 collDecimals;
        uint256 collMCR;
        uint remainingLUSD;
        ISortedTroves sortedTroves;
        address currentTroveuser;
        uint netLUSDDebt;
        uint maxRedeemableLUSD;
        uint collAmount;
        uint newColl;
        uint newDebt;
        uint compositeDebt;
    }

    function getRedemptionHints(
        address _collateral,
        uint _LUSDamount, 
        uint _price,
        uint _maxIterations
    )
        external
        view
        returns (
            address firstRedemptionHint,
            uint partialRedemptionHintNICR,
            uint truncatedLUSDamount
        )
    {
        _requireValidCollateralAddress(_collateral);
        LocalVariables_getRedemptionHints memory vars;

        vars.collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        vars.collMCR = collateralConfig.getCollateralMCR(_collateral);
        vars.remainingLUSD = _LUSDamount;
        vars.sortedTroves = sortedTroves;
        vars.currentTroveuser = vars.sortedTroves.getLast(_collateral);

        while (
            vars.currentTroveuser != address(0) &&
            troveManager.getCurrentICR(vars.currentTroveuser, _collateral, _price) < vars.collMCR
        ) {
            vars.currentTroveuser = vars.sortedTroves.getPrev(_collateral, vars.currentTroveuser);
        }

        firstRedemptionHint = vars.currentTroveuser;

        if (_maxIterations == 0) {
            _maxIterations = uint(-1);
        }

        while (vars.currentTroveuser != address(0) && vars.remainingLUSD > 0 && _maxIterations-- > 0) {
            vars.netLUSDDebt = _getNetDebt(troveManager.getTroveDebt(vars.currentTroveuser, _collateral))
                .add(troveManager.getPendingLUSDDebtReward(vars.currentTroveuser, _collateral));

            if (vars.netLUSDDebt > vars.remainingLUSD) {
                if (vars.netLUSDDebt > MIN_NET_DEBT) {
                    vars.maxRedeemableLUSD = LiquityMath._min(vars.remainingLUSD, vars.netLUSDDebt.sub(MIN_NET_DEBT));

                    vars.collAmount = troveManager.getTroveColl(vars.currentTroveuser, _collateral)
                        .add(troveManager.getPendingCollateralReward(vars.currentTroveuser, _collateral));

                    vars.newColl = vars.collAmount.sub(vars.maxRedeemableLUSD.mul(10**vars.collDecimals).div(_price));
                    vars.newDebt = vars.netLUSDDebt.sub(vars.maxRedeemableLUSD);

                    vars.compositeDebt = _getCompositeDebt(vars.newDebt);
                    partialRedemptionHintNICR = LiquityMath._computeNominalCR(vars.newColl, vars.compositeDebt, vars.collDecimals);

                    vars.remainingLUSD = vars.remainingLUSD.sub(vars.maxRedeemableLUSD);
                }
                break;
            } else {
                vars.remainingLUSD = vars.remainingLUSD.sub(vars.netLUSDDebt);
            }

            vars.currentTroveuser = vars.sortedTroves.getPrev(_collateral, vars.currentTroveuser);
        }

        truncatedLUSDamount = _LUSDamount.sub(vars.remainingLUSD);
    }

    /* getApproxHint() - return address of a Trove that is, on average, (length / numTrials) positions away in the 
    sortedTroves list from the correct insert position of the Trove to be inserted. 
    
    Note: The output address is worst-case O(n) positions away from the correct insert position, however, the function 
    is probabilistic. Input can be tuned to guarantee results to a high degree of confidence, e.g:

    Submitting numTrials = k * sqrt(length), with k = 15 makes it very, very likely that the ouput address will 
    be <= sqrt(length) positions away from the correct insert position.
    */
    function getApproxHint(address _collateral, uint _CR, uint _numTrials, uint _inputRandomSeed)
        external
        view
        returns (address hintAddress, uint diff, uint latestRandomSeed)
    {
        _requireValidCollateralAddress(_collateral);
        uint arrayLength = troveManager.getTroveOwnersCount(_collateral);

        if (arrayLength == 0) {
            return (address(0), 0, _inputRandomSeed);
        }

        hintAddress = sortedTroves.getLast(_collateral);
        diff = LiquityMath._getAbsoluteDifference(_CR, troveManager.getNominalICR(hintAddress, _collateral));
        latestRandomSeed = _inputRandomSeed;

        uint i = 1;

        while (i < _numTrials) {
            latestRandomSeed = uint(keccak256(abi.encodePacked(latestRandomSeed)));

            uint arrayIndex = latestRandomSeed % arrayLength;
            address currentAddress = troveManager.getTroveFromTroveOwnersArray(_collateral, arrayIndex);
            uint currentNICR = troveManager.getNominalICR(currentAddress, _collateral);

            // check if abs(current - CR) > abs(closest - CR), and update closest if current is closer
            uint currentDiff = LiquityMath._getAbsoluteDifference(currentNICR, _CR);

            if (currentDiff < diff) {
                diff = currentDiff;
                hintAddress = currentAddress;
            }
            i++;
        }
    }

    function computeNominalCR(uint _coll, uint _debt, uint8 _collDecimals) external pure returns (uint) {
        return LiquityMath._computeNominalCR(_coll, _debt, _collDecimals);
    }

    function computeCR(uint _coll, uint _debt, uint _price, uint8 _collDecimals) external pure returns (uint) {
        return LiquityMath._computeCR(_coll, _debt, _price, _collDecimals);
    }

    // --- 'require' functions ---

    function _requireValidCollateralAddress(address _collateral) internal view {
        require(collateralConfig.isCollateralAllowed(_collateral),"Invalid collateral address");
    }
}
