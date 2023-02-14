// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;


interface ICollSurplusPool {

    // --- Events ---
    
    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _newActivePoolAddress);

    event CollBalanceUpdated(address indexed _account, address _collateral, uint _newBalance);
    event CollateralSent(address _collateral, address _to, uint _amount);

    // --- Contract setters ---

    function setAddresses(
        address _collateralConfigAddress,
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _activePoolAddress
    ) external;

    function getCollateral(address _collateral) external view returns (uint);

    function getUserCollateral(address _account, address _collateral) external view returns (uint);

    function accountSurplus(address _account, address _collateral, uint _amount) external;

    function claimColl(address _account, address _collateral) external;

    function pullCollateralFromActivePool(address _collateral, uint _amount) external;
}
