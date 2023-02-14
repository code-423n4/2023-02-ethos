// SPDX-License-Identifier: agpl-3.0

pragma solidity ^0.8.0;

import "../interfaces/IERC20Minimal.sol";

library SafeERC20Minimal {
    // Wrapper over IERC20Minimal#approve() to revert on false return value
    function _safeIncreaseAllowance(
        IERC20Minimal _token,
        address _account,
        uint256 _amount
    ) internal {
        uint256 newAllowance = _token.allowance(address(this), _account) + _amount;
        require(_token.approve(_account, newAllowance), "Safe increase allowance failed");
    }
}
