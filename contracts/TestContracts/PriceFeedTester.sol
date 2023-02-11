// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../PriceFeed.sol";

contract PriceFeedTester is PriceFeed {

    function setLastGoodPrice(address _collateral, uint _lastGoodPrice) external {
        lastGoodPrice[_collateral] = _lastGoodPrice;
    }

    function setStatus(address _collateral, Status _status) external {
        status[_collateral] = _status;
    }
}