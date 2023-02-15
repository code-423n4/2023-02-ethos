// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

interface IMappingContract{
    function getTellorID(bytes32 _id) external view returns(bytes32);
}
