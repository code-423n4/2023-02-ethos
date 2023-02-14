// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../StabilityPool.sol";

contract StabilityPoolTester is StabilityPool {
    
    function unprotectedPullCollateral(address _collateral, uint _amount) external {
        collAmounts[_collateral] = collAmounts[_collateral].add(_amount);
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _amount);
    }

    function setCurrentScale(uint128 _currentScale) external {
        currentScale = _currentScale;
    }

    function setTotalDeposits(uint _totalLUSDDeposits) external {
        totalLUSDDeposits = _totalLUSDDeposits;
    }
}
