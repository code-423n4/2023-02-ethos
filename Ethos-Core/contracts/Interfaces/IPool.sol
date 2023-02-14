// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

// Common interface for the Pools.
interface IPool {
    
    // --- Events ---
    
    event ActivePoolAddressChanged(address _newActivePoolAddress);
    event DefaultPoolAddressChanged(address _newDefaultPoolAddress);
    event StabilityPoolAddressChanged(address _newStabilityPoolAddress);
    event CollateralSent(address _collateral, address _to, uint _amount);

    // --- Functions ---
    
    function getCollateral(address _collateral) external view returns (uint);

    function getLUSDDebt(address _collateral) external view returns (uint);

    function increaseLUSDDebt(address _collateral, uint _amount) external;

    function decreaseLUSDDebt(address _collateral, uint _amount) external;
}
