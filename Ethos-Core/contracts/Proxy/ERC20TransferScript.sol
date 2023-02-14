// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../Dependencies/IERC20.sol";

contract ERC20TransferScript {
    function transferERC20(address _token, address _recipient, uint256 _amount) external returns (bool) {
        return IERC20(_token).transfer(_recipient, _amount);
    }
}
