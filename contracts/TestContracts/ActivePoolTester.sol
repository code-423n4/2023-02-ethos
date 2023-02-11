// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../ActivePool.sol";

contract ActivePoolTester is ActivePool {
    
    function unprotectedIncreaseLUSDDebt(address _collateral, uint _amount) external {
        LUSDDebt[_collateral] = LUSDDebt[_collateral].add(_amount);
    }

    function unprotectedPullCollateral(address _collateral, uint _amount) external {
        collAmount[_collateral] = collAmount[_collateral].add(_amount);
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _amount);
    }
}
