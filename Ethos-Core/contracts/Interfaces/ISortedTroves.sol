// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

// Common interface for the SortedTroves Doubly Linked List.
interface ISortedTroves {

    // --- Events ---
    
    event SortedTrovesAddressChanged(address _sortedDoublyLLAddress);
    event BorrowerOperationsAddressChanged(address _borrowerOperationsAddress);
    event NodeAdded(address _collateral, address _id, uint _NICR);
    event NodeRemoved(address _collateral, address _id);

    // --- Functions ---
    
    function setParams(address _TroveManagerAddress, address _borrowerOperationsAddress) external;

    function insert(address _collateral, address _id, uint256 _ICR, address _prevId, address _nextId) external;

    function remove(address _collateral, address _id) external;

    function reInsert(address _id, address _collateral, uint256 _newICR, address _prevId, address _nextId) external;

    function contains(address _collateral, address _id) external view returns (bool);

    function isEmpty(address _collateral) external view returns (bool);

    function getSize(address _collateral) external view returns (uint256);

    function getFirst(address _collateral) external view returns (address);

    function getLast(address _collateral) external view returns (address);

    function getNext(address _collateral, address _id) external view returns (address);

    function getPrev(address _collateral, address _id) external view returns (address);

    function validInsertPosition(address _collateral, uint256 _ICR, address _prevId, address _nextId) external view returns (bool);

    function findInsertPosition(address _collateral, uint256 _ICR, address _prevId, address _nextId) external view returns (address, address);
}
