// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);
}
