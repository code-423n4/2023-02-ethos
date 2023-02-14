// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../BorrowerOperations.sol";

/* Tester contract inherits from BorrowerOperations, and provides external functions 
for testing the parent's internal functions. */
contract BorrowerOperationsTester is BorrowerOperations {

    function getNewICRFromTroveChange
    (
        uint _coll, 
        uint _debt, 
        uint _collChange, 
        bool isCollIncrease, 
        uint _debtChange, 
        bool isDebtIncrease, 
        uint _price,
        uint256 _collDecimals
    ) 
    external
    pure
    returns (uint)
    {
        return _getNewICRFromTroveChange(
            _coll,
            _debt,
            _collChange,
            isCollIncrease,
            _debtChange,
            isDebtIncrease,
            _price,
            _collDecimals
        );
    }

    function getNewTCRFromTroveChange
    (
        address _collateral,
        uint _collChange, 
        bool isCollIncrease,  
        uint _debtChange, 
        bool isDebtIncrease, 
        uint _price
    ) 
    external 
    view
    returns (uint) 
    {
        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        return _getNewTCRFromTroveChange(
            _collateral,
            _collChange,
            isCollIncrease,
            _debtChange,
            isDebtIncrease,
            _price,
            collDecimals
        );
    }

    function getUSDValue(uint _coll, uint _price, uint256 _collDecimals) external pure returns (uint) {
        return _getUSDValue(_coll, _price, _collDecimals);
    }

    function callInternalAdjustLoan
    (
        address _borrower,
        address _collateral,
        uint _collTopUp,
        uint _collWithdrawal, 
        uint _debtChange, 
        bool _isDebtIncrease, 
        address _upperHint,
        address _lowerHint)
        external 
    {
        _adjustTrove(_borrower, _collateral, _collTopUp, _collWithdrawal, _debtChange, _isDebtIncrease, _upperHint, _lowerHint, 0);
    }
}
