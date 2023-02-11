// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../Interfaces/ISortedTroves.sol";


contract SortedTrovesTester {
    ISortedTroves sortedTroves;

    function setSortedTroves(address _sortedTrovesAddress) external {
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
    }

    function insert(address _collateral, address _id, uint256 _NICR, address _prevId, address _nextId) external {
        sortedTroves.insert(_collateral, _id, _NICR, _prevId, _nextId);
    }

    function remove(address _collateral, address _id) external {
        sortedTroves.remove(_collateral, _id);
    }

    function reInsert(address _id, address _collateral, uint256 _newNICR, address _prevId, address _nextId) external {
        sortedTroves.reInsert(_id, _collateral, _newNICR, _prevId, _nextId);
    }

    function getNominalICR(address, address) external pure returns (uint) {
        return 1;
    }

    function getCurrentICR(address, address, uint) external pure returns (uint) {
        return 1;
    }
}
