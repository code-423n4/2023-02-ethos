// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

interface ITellorCaller {
    function getTellorCurrentValue(bytes32 _queryId) external view returns (bool, uint256, uint256);
}