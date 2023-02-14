// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Dependencies/SafeERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";


contract BorrowerOperationsScript is CheckContract {
    using SafeERC20 for IERC20;

    IBorrowerOperations immutable borrowerOperations;

    constructor(IBorrowerOperations _borrowerOperations) public {
        checkContract(address(_borrowerOperations));
        borrowerOperations = _borrowerOperations;
    }

    function openTrove(address _collateral, uint _collAmount, uint _maxFee, uint _LUSDAmount, address _upperHint, address _lowerHint) external {
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collAmount);
        IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), _collAmount);
        borrowerOperations.openTrove(_collateral, _collAmount, _maxFee, _LUSDAmount, _upperHint, _lowerHint);
    }

    function addColl(address _collateral, uint _collAmount, address _upperHint, address _lowerHint) external {
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collAmount);
        IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), _collAmount);
        borrowerOperations.addColl(_collateral, _collAmount, _upperHint, _lowerHint);
    }

    function withdrawColl(address _collateral, uint _amount, address _upperHint, address _lowerHint) external {
        borrowerOperations.withdrawColl(_collateral, _amount, _upperHint, _lowerHint);
    }

    function withdrawLUSD(address _collateral, uint _maxFee, uint _amount, address _upperHint, address _lowerHint) external {
        borrowerOperations.withdrawLUSD(_collateral, _maxFee, _amount, _upperHint, _lowerHint);
    }

    function repayLUSD(address _collateral, uint _amount, address _upperHint, address _lowerHint) external {
        borrowerOperations.repayLUSD(_collateral, _amount, _upperHint, _lowerHint);
    }

    function closeTrove(address _collateral) external {
        borrowerOperations.closeTrove(_collateral);
    }

    function adjustTrove(address _collateral, uint _maxFee, uint _collTopUp, uint _collWithdrawal, uint _debtChange, bool isDebtIncrease, address _upperHint, address _lowerHint) external {
        if (_collTopUp != 0) {
            IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collTopUp);
            IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), _collTopUp);
        }
        borrowerOperations.adjustTrove(_collateral, _maxFee, _collTopUp, _collWithdrawal, _debtChange, isDebtIncrease, _upperHint, _lowerHint);
    }

    function claimCollateral(address _collateral) external {
        borrowerOperations.claimCollateral(_collateral);
    }
}
