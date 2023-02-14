// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

contract Destructible {
    
    receive() external payable {}
    
    function destruct(address payable _receiver) external {
        selfdestruct(_receiver);
    }
}
