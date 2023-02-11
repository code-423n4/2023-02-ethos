// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

// Common interface for the Trove Manager.
interface IBorrowerOperations {

    // --- Events ---

    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _activePoolAddress);
    event DefaultPoolAddressChanged(address _defaultPoolAddress);
    event StabilityPoolAddressChanged(address _stabilityPoolAddress);
    event GasPoolAddressChanged(address _gasPoolAddress);
    event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
    event PriceFeedAddressChanged(address  _newPriceFeedAddress);
    event SortedTrovesAddressChanged(address _sortedTrovesAddress);
    event LUSDTokenAddressChanged(address _lusdTokenAddress);
    event LQTYStakingAddressChanged(address _lqtyStakingAddress);

    event TroveCreated(address indexed _borrower, address _collateral, uint arrayIndex);
    event TroveUpdated(address indexed _borrower, address _collateral, uint _debt, uint _coll, uint stake, uint8 operation);
    event LUSDBorrowingFeePaid(address indexed _borrower, address _collateral, uint _LUSDFee);

    // --- Functions ---

    function setAddresses(
        address _collateralConfigAddress,
        address _troveManagerAddress,
        address _activePoolAddress,
        address _defaultPoolAddress,
        address _stabilityPoolAddress,
        address _gasPoolAddress,
        address _collSurplusPoolAddress,
        address _priceFeedAddress,
        address _sortedTrovesAddress,
        address _lusdTokenAddress,
        address _lqtyStakingAddress
    ) external;

    function openTrove(address _collateral, uint _collAmount, uint _maxFee, uint _LUSDAmount, address _upperHint, address _lowerHint) external;

    function addColl(address _collateral, uint _collAmount, address _upperHint, address _lowerHint) external;

    function moveCollateralGainToTrove(address _user, address _collateral, uint _collAmount, address _upperHint, address _lowerHint) external;

    function withdrawColl(address _collateral, uint _amount, address _upperHint, address _lowerHint) external;

    function withdrawLUSD(address _collateral, uint _maxFee, uint _amount, address _upperHint, address _lowerHint) external;

    function repayLUSD(address _collateral, uint _amount, address _upperHint, address _lowerHint) external;

    function closeTrove(address _collateral) external;

    function adjustTrove(address _collateral, uint _maxFee, uint _collTopUp, uint _collWithdrawal, uint _debtChange, bool isDebtIncrease, address _upperHint, address _lowerHint) external;

    function claimCollateral(address _collateral) external;

    function getCompositeDebt(uint _debt) external pure returns (uint);
}
