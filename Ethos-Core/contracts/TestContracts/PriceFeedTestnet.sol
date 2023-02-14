// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../Interfaces/IPriceFeed.sol";

/*
* PriceFeed placeholder for testnet and development. The price is simply set manually and saved in a state 
* variable. The contract does not connect to a live Chainlink price feed. 
*/
contract PriceFeedTestnet is IPriceFeed {
    
    mapping (address => uint256) private _price;

    // --- Functions ---

    // View price getter for simplicity in tests
    function getPrice(address _collateral) external view returns (uint256) {
        return _price[_collateral];
    }

    function fetchPrice(address _collateral) external override returns (uint256) {
        // Fire an event just like the mainnet version would.
        // This lets the subgraph rely on events to get the latest price even when developing locally.
        emit LastGoodPriceUpdated(_collateral, _price[_collateral]);
        return _price[_collateral];
    }

    // Manual external price setter.
    function setPrice(address _collateral, uint256 price) external returns (bool) {
        _price[_collateral] = price;
        return true;
    }
}
