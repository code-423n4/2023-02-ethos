// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "./Interfaces/ICollateralConfig.sol";
import "./TroveManager.sol";
import "./SortedTroves.sol";

/*  Helper contract for grabbing Trove data for the front end. Not part of the core Liquity system. */
contract MultiTroveGetter {
    struct CombinedTroveData {
        address owner;

        uint debt;
        uint coll;
        uint stake;

        uint snapshotCollAmount;
        uint snapshotLUSDDebt;
    }

    ICollateralConfig public collateralConfig;
    TroveManager public troveManager; // XXX Troves missing from ITroveManager?
    ISortedTroves public sortedTroves;

    constructor(ICollateralConfig _collateralConfig, TroveManager _troveManager, ISortedTroves _sortedTroves) public {
        collateralConfig = _collateralConfig;
        troveManager = _troveManager;
        sortedTroves = _sortedTroves;
    }

    function getMultipleSortedTroves(address _collateral, int _startIdx, uint _count)
        external view returns (CombinedTroveData[] memory _troves)
    {
        require(collateralConfig.isCollateralAllowed(_collateral),"Invalid collateral address");
        uint startIdx;
        bool descend;

        if (_startIdx >= 0) {
            startIdx = uint(_startIdx);
            descend = true;
        } else {
            startIdx = uint(-(_startIdx + 1));
            descend = false;
        }

        uint sortedTrovesSize = sortedTroves.getSize(_collateral);

        if (startIdx >= sortedTrovesSize) {
            _troves = new CombinedTroveData[](0);
        } else {
            uint maxCount = sortedTrovesSize - startIdx;

            if (_count > maxCount) {
                _count = maxCount;
            }

            if (descend) {
                _troves = _getMultipleSortedTrovesFromHead(_collateral, startIdx, _count);
            } else {
                _troves = _getMultipleSortedTrovesFromTail(_collateral, startIdx, _count);
            }
        }
    }

    function _getMultipleSortedTrovesFromHead(address _collateral, uint _startIdx, uint _count)
        internal view returns (CombinedTroveData[] memory _troves)
    {
        address currentTroveowner = sortedTroves.getFirst(_collateral);

        for (uint idx = 0; idx < _startIdx; ++idx) {
            currentTroveowner = sortedTroves.getNext(_collateral, currentTroveowner);
        }

        _troves = new CombinedTroveData[](_count);

        for (uint idx = 0; idx < _count; ++idx) {
            _troves[idx].owner = currentTroveowner;
            (
                _troves[idx].debt,
                _troves[idx].coll,
                _troves[idx].stake,
                /* status */,
                /* arrayIndex */
            ) = troveManager.Troves(currentTroveowner, _collateral);
            (
                _troves[idx].snapshotCollAmount,
                _troves[idx].snapshotLUSDDebt
            ) = troveManager.rewardSnapshots(currentTroveowner, _collateral);

            currentTroveowner = sortedTroves.getNext(_collateral, currentTroveowner);
        }
    }

    function _getMultipleSortedTrovesFromTail(address _collateral, uint _startIdx, uint _count)
        internal view returns (CombinedTroveData[] memory _troves)
    {
        address currentTroveowner = sortedTroves.getLast(_collateral);

        for (uint idx = 0; idx < _startIdx; ++idx) {
            currentTroveowner = sortedTroves.getPrev(_collateral, currentTroveowner);
        }

        _troves = new CombinedTroveData[](_count);

        for (uint idx = 0; idx < _count; ++idx) {
            _troves[idx].owner = currentTroveowner;
            (
                _troves[idx].debt,
                _troves[idx].coll,
                _troves[idx].stake,
                /* status */,
                /* arrayIndex */
            ) = troveManager.Troves(currentTroveowner, _collateral);
            (
                _troves[idx].snapshotCollAmount,
                _troves[idx].snapshotLUSDDebt
            ) = troveManager.rewardSnapshots(currentTroveowner, _collateral);

            currentTroveowner = sortedTroves.getPrev(_collateral, currentTroveowner);
        }
    }
}
