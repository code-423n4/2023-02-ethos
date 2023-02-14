// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "./Interfaces/ISortedTroves.sol";
import "./Interfaces/ITroveManager.sol";
import "./Interfaces/IBorrowerOperations.sol";
import "./Dependencies/SafeMath.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/console.sol";

/*
* A sorted doubly linked list with nodes sorted in descending order.
*
* Nodes map to active Troves in the system - the ID property is the address of a Trove owner.
* Nodes are ordered according to their current nominal individual collateral ratio (NICR),
* which is like the ICR but without the price, i.e., just collateral / debt.
*
* The list optionally accepts insert position hints.
*
* NICRs are computed dynamically at runtime, and not stored on the Node. This is because NICRs of active Troves
* change dynamically as liquidation events occur.
*
* The list relies on the fact that liquidation events preserve ordering: a liquidation decreases the NICRs of all active Troves,
* but maintains their order. A node inserted based on current NICR will maintain the correct position,
* relative to it's peers, as rewards accumulate, as long as it's raw collateral and debt have not changed.
* Thus, Nodes remain sorted by current NICR.
*
* Nodes need only be re-inserted upon a Trove operation - when the owner adds or removes collateral or debt
* to their position.
*
* The list is a modification of the following audited SortedDoublyLinkedList:
* https://github.com/livepeer/protocol/blob/master/contracts/libraries/SortedDoublyLL.sol
*
*
* Changes made in the Liquity implementation:
*
* - Keys have been removed from nodes
*
* - Ordering checks for insertion are performed by comparing an NICR argument to the current NICR, calculated at runtime.
*   The list relies on the property that ordering by ICR is maintained as the ETH:USD price varies.
*
* - Public functions with parameters have been made internal to save gas, and given an external wrapper function for external access
*/
contract SortedTroves is Ownable, CheckContract, ISortedTroves {
    using SafeMath for uint256;

    string constant public NAME = "SortedTroves";

    event TroveManagerAddressChanged(address _troveManagerAddress);
    event BorrowerOperationsAddressChanged(address _borrowerOperationsAddress);
    event NodeAdded(address _collateral, address _id, uint _NICR);
    event NodeRemoved(address _collateral, address _id);

    address public borrowerOperationsAddress;

    ITroveManager public troveManager;

    // Information for a node in the list
    struct Node {
        bool exists;
        address nextId;                  // Id of next node (smaller NICR) in the list
        address prevId;                  // Id of previous node (larger NICR) in the list
    }

    // Information for the list
    struct Data {
        address head;                        // Head of the list. Also the node in the list with the largest NICR
        address tail;                        // Tail of the list. Also the node in the list with the smallest NICR
        uint256 size;                        // Current size of the list
        mapping (address => Node) nodes;     // Track the corresponding ids for each node in the list
    }

    // Each collateral has its own list of sorted troves
    mapping (address => Data) public data;

    // --- Dependency setters ---

    function setParams(address _troveManagerAddress, address _borrowerOperationsAddress) external override onlyOwner {
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);

        troveManager = ITroveManager(_troveManagerAddress);
        borrowerOperationsAddress = _borrowerOperationsAddress;

        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);

        _renounceOwnership();
    }

    /*
     * @dev Add a node to the list
     * @param _collateral Identifier for the list to operate on
     * @param _id Node's id
     * @param _NICR Node's NICR
     * @param _prevId Id of previous node for the insert position
     * @param _nextId Id of next node for the insert position
     */

    function insert (address _collateral, address _id, uint256 _NICR, address _prevId, address _nextId) external override {
        ITroveManager troveManagerCached = troveManager;

        _requireCallerIsBOorTroveM(troveManagerCached);
        _insert(troveManagerCached, _collateral, _id, _NICR, _prevId, _nextId);
    }

    function _insert(ITroveManager _troveManager, address _collateral, address _id, uint256 _NICR, address _prevId, address _nextId) internal {
        // List must not already contain node
        require(!contains(_collateral, _id), "SortedTroves: List already contains the node");
        // Node id must not be null
        require(_id != address(0), "SortedTroves: Id cannot be zero");
        // NICR must be non-zero
        require(_NICR > 0, "SortedTroves: NICR must be positive");

        address prevId = _prevId;
        address nextId = _nextId;

        if (!_validInsertPosition(_troveManager, _collateral, _NICR, prevId, nextId)) {
            // Sender's hint was not a valid insert position
            // Use sender's hint to find a valid insert position
            (prevId, nextId) = _findInsertPosition(_troveManager, _collateral, _NICR, prevId, nextId);
        }

         data[_collateral].nodes[_id].exists = true;

        if (prevId == address(0) && nextId == address(0)) {
            // Insert as head and tail
            data[_collateral].head = _id;
            data[_collateral].tail = _id;
        } else if (prevId == address(0)) {
            // Insert before `prevId` as the head
            data[_collateral].nodes[_id].nextId = data[_collateral].head;
            data[_collateral].nodes[data[_collateral].head].prevId = _id;
            data[_collateral].head = _id;
        } else if (nextId == address(0)) {
            // Insert after `nextId` as the tail
            data[_collateral].nodes[_id].prevId = data[_collateral].tail;
            data[_collateral].nodes[data[_collateral].tail].nextId = _id;
            data[_collateral].tail = _id;
        } else {
            // Insert at insert position between `prevId` and `nextId`
            data[_collateral].nodes[_id].nextId = nextId;
            data[_collateral].nodes[_id].prevId = prevId;
            data[_collateral].nodes[prevId].nextId = _id;
            data[_collateral].nodes[nextId].prevId = _id;
        }

        data[_collateral].size = data[_collateral].size.add(1);
        emit NodeAdded(_collateral, _id, _NICR);
    }

    function remove(address _collateral, address _id) external override {
        _requireCallerIsTroveManager();
        _remove(_collateral, _id);
    }

    /*
     * @dev Remove a node from the list
     * @param _collateral Address of the collateral whose list to be removed from
     * @param _id Node's id
     */
    function _remove(address _collateral, address _id) internal {
        // List must contain the node
        require(contains(_collateral, _id), "SortedTroves: List does not contain the id");

        if (data[_collateral].size > 1) {
            // List contains more than a single node
            if (_id == data[_collateral].head) {
                // The removed node is the head
                // Set head to next node
                data[_collateral].head = data[_collateral].nodes[_id].nextId;
                // Set prev pointer of new head to null
                data[_collateral].nodes[data[_collateral].head].prevId = address(0);
            } else if (_id == data[_collateral].tail) {
                // The removed node is the tail
                // Set tail to previous node
                data[_collateral].tail = data[_collateral].nodes[_id].prevId;
                // Set next pointer of new tail to null
                data[_collateral].nodes[data[_collateral].tail].nextId = address(0);
            } else {
                // The removed node is neither the head nor the tail
                // Set next pointer of previous node to the next node
                data[_collateral].nodes[data[_collateral].nodes[_id].prevId].nextId = data[_collateral].nodes[_id].nextId;
                // Set prev pointer of next node to the previous node
                data[_collateral].nodes[data[_collateral].nodes[_id].nextId].prevId = data[_collateral].nodes[_id].prevId;
            }
        } else {
            // List contains a single node
            // Set the head and tail to null
            data[_collateral].head = address(0);
            data[_collateral].tail = address(0);
        }

        delete data[_collateral].nodes[_id];
        data[_collateral].size = data[_collateral].size.sub(1);
        NodeRemoved(_collateral, _id);
    }

    /*
     * @dev Re-insert the node at a new position, based on its new NICR
     * @param _id Node's id
     * @param _collateral Address of collateral whose list is to be inserted into
     * @param _newNICR Node's new NICR
     * @param _prevId Id of previous node for the new insert position
     * @param _nextId Id of next node for the new insert position
     */
    function reInsert(address _id, address _collateral, uint256 _newNICR, address _prevId, address _nextId) external override {
        ITroveManager troveManagerCached = troveManager;

        _requireCallerIsBOorTroveM(troveManagerCached);
        // List must contain the node
        require(contains(_collateral, _id), "SortedTroves: List does not contain the id");
        // NICR must be non-zero
        require(_newNICR > 0, "SortedTroves: NICR must be positive");

        // Remove node from the list
        _remove(_collateral, _id);

        _insert(troveManagerCached, _collateral, _id, _newNICR, _prevId, _nextId);
    }

    /*
     * @dev Checks if the specified collateral's list contains a node
     */
    function contains(address _collateral, address _id) public view override returns (bool) {
        return data[_collateral].nodes[_id].exists;
    }

    /*
     * @dev Checks if the specified collateral's list is empty
     */
    function isEmpty(address _collateral) public view override returns (bool) {
        return data[_collateral].size == 0;
    }

    /*
     * @dev Returns the current size of the list for the specified collateral
     */
    function getSize(address _collateral) external view override returns (uint256) {
        return data[_collateral].size;
    }

    /*
     * @dev Returns the first node in the list for the specified collateral (node with the largest NICR)
     */
    function getFirst(address _collateral) external view override returns (address) {
        return data[_collateral].head;
    }

    /*
     * @dev Returns the last node in the list for the specified collateral(node with the smallest NICR)
     */
    function getLast(address _collateral) external view override returns (address) {
        return data[_collateral].tail;
    }

    /*
     * @dev Returns the next node (with a smaller NICR) in the specified collateral's list for a given node
     * @param _collateral Address of collateral whose list to look at
     * @param _id Node's id
     */
    function getNext(address _collateral, address _id) external view override returns (address) {
        return data[_collateral].nodes[_id].nextId;
    }

    /*
     * @dev Returns the previous node (with a larger NICR) in the specified collateral's list for a given node
     * @param _collateral Address of collateral whose list to look at
     * @param _id Node's id
     */
    function getPrev(address _collateral, address _id) external view override returns (address) {
        return data[_collateral].nodes[_id].prevId;
    }

    /*
     * @dev Check if a pair of nodes is a valid insertion point for a new node with the given NICR
     * @param _collateral Address of collateral whose list is being checked against
     * @param _NICR Node's NICR
     * @param _prevId Id of previous node for the insert position
     * @param _nextId Id of next node for the insert position
     */
    function validInsertPosition(address _collateral, uint256 _NICR, address _prevId, address _nextId) external view override returns (bool) {
        return _validInsertPosition(troveManager, _collateral, _NICR, _prevId, _nextId);
    }

    function _validInsertPosition(ITroveManager _troveManager, address _collateral, uint256 _NICR, address _prevId, address _nextId) internal view returns (bool) {
        if (_prevId == address(0) && _nextId == address(0)) {
            // `(null, null)` is a valid insert position if the list is empty
            return isEmpty(_collateral);
        } else if (_prevId == address(0)) {
            // `(null, _nextId)` is a valid insert position if `_nextId` is the head of the list
            return data[_collateral].head == _nextId && _NICR >= _troveManager.getNominalICR(_nextId, _collateral);
        } else if (_nextId == address(0)) {
            // `(_prevId, null)` is a valid insert position if `_prevId` is the tail of the list
            return data[_collateral].tail == _prevId && _NICR <= _troveManager.getNominalICR(_prevId, _collateral);
        } else {
            // `(_prevId, _nextId)` is a valid insert position if they are adjacent nodes and `_NICR` falls between the two nodes' NICRs
            return data[_collateral].nodes[_prevId].nextId == _nextId &&
                   _troveManager.getNominalICR(_prevId, _collateral) >= _NICR &&
                   _NICR >= _troveManager.getNominalICR(_nextId, _collateral);
        }
    }

    /*
     * @dev Descend the list (larger NICRs to smaller NICRs) to find a valid insert position
     * @param _troveManager TroveManager contract, passed in as param to save SLOAD’s
     * @param _collateral Address for the collateral whose list is going to be traversed
     * @param _NICR Node's NICR
     * @param _startId Id of node to start descending the list from
     */
    function _descendList(ITroveManager _troveManager, address _collateral, uint256 _NICR, address _startId) internal view returns (address, address) {
        // If `_startId` is the head, check if the insert position is before the head
        if (data[_collateral].head == _startId && _NICR >= _troveManager.getNominalICR(_startId, _collateral)) {
            return (address(0), _startId);
        }

        address prevId = _startId;
        address nextId = data[_collateral].nodes[prevId].nextId;

        // Descend the list until we reach the end or until we find a valid insert position
        while (prevId != address(0) && !_validInsertPosition(_troveManager, _collateral, _NICR, prevId, nextId)) {
            prevId = data[_collateral].nodes[prevId].nextId;
            nextId = data[_collateral].nodes[prevId].nextId;
        }

        return (prevId, nextId);
    }

    /*
     * @dev Ascend the list (smaller NICRs to larger NICRs) to find a valid insert position
     * @param _troveManager TroveManager contract, passed in as param to save SLOAD’s
     * @param _collateral Address for the collateral whose list is going to be traversed
     * @param _NICR Node's NICR
     * @param _startId Id of node to start ascending the list from
     */
    function _ascendList(ITroveManager _troveManager, address _collateral, uint256 _NICR, address _startId) internal view returns (address, address) {
        // If `_startId` is the tail, check if the insert position is after the tail
        if (data[_collateral].tail == _startId && _NICR <= _troveManager.getNominalICR(_startId, _collateral)) {
            return (_startId, address(0));
        }

        address nextId = _startId;
        address prevId = data[_collateral].nodes[nextId].prevId;

        // Ascend the list until we reach the end or until we find a valid insertion point
        while (nextId != address(0) && !_validInsertPosition(_troveManager, _collateral, _NICR, prevId, nextId)) {
            nextId = data[_collateral].nodes[nextId].prevId;
            prevId = data[_collateral].nodes[nextId].prevId;
        }

        return (prevId, nextId);
    }

    /*
     * @dev Find the insert position for a new node with the given NICR
     * @param _collateral Address of collateral whose list is being checked against
     * @param _NICR Node's NICR
     * @param _prevId Id of previous node for the insert position
     * @param _nextId Id of next node for the insert position
     */
    function findInsertPosition(address _collateral, uint256 _NICR, address _prevId, address _nextId) external view override returns (address, address) {
        return _findInsertPosition(troveManager, _collateral, _NICR, _prevId, _nextId);
    }

    function _findInsertPosition(ITroveManager _troveManager, address _collateral, uint256 _NICR, address _prevId, address _nextId) internal view returns (address, address) {
        address prevId = _prevId;
        address nextId = _nextId;

        if (prevId != address(0)) {
            if (!contains(_collateral, prevId) || _NICR > _troveManager.getNominalICR(prevId, _collateral)) {
                // `prevId` does not exist anymore or now has a smaller NICR than the given NICR
                prevId = address(0);
            }
        }

        if (nextId != address(0)) {
            if (!contains(_collateral, nextId) || _NICR < _troveManager.getNominalICR(nextId, _collateral)) {
                // `nextId` does not exist anymore or now has a larger NICR than the given NICR
                nextId = address(0);
            }
        }

        if (prevId == address(0) && nextId == address(0)) {
            // No hint - descend list starting from head
            return _descendList(_troveManager, _collateral, _NICR, data[_collateral].head);
        } else if (prevId == address(0)) {
            // No `prevId` for hint - ascend list starting from `nextId`
            return _ascendList(_troveManager, _collateral, _NICR, nextId);
        } else if (nextId == address(0)) {
            // No `nextId` for hint - descend list starting from `prevId`
            return _descendList(_troveManager, _collateral, _NICR, prevId);
        } else {
            // Descend list starting from `prevId`
            return _descendList(_troveManager, _collateral, _NICR, prevId);
        }
    }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == address(troveManager), "SortedTroves: Caller is not the TroveManager");
    }

    function _requireCallerIsBOorTroveM(ITroveManager _troveManager) internal view {
        require(msg.sender == borrowerOperationsAddress || msg.sender == address(_troveManager),
                "SortedTroves: Caller is neither BO nor TroveM");
    }
}
