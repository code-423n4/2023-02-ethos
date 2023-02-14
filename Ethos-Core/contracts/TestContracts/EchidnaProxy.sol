// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../TroveManager.sol";
import "../BorrowerOperations.sol";
import "../StabilityPool.sol";
import "../LUSDToken.sol";
import "../Dependencies/SafeERC20.sol";

contract EchidnaProxy {
    using SafeERC20 for IERC20;

    TroveManager troveManager;
    BorrowerOperations borrowerOperations;
    StabilityPool stabilityPool;
    LUSDToken lusdToken;

    constructor(
        TroveManager _troveManager,
        BorrowerOperations _borrowerOperations,
        StabilityPool _stabilityPool,
        LUSDToken _lusdToken
    ) public {
        troveManager = _troveManager;
        borrowerOperations = _borrowerOperations;
        stabilityPool = _stabilityPool;
        lusdToken = _lusdToken;
    }

    // TroveManager

    function liquidatePrx(address _user, address _collateral) external {
        troveManager.liquidate(_user, _collateral);
    }

    function liquidateTrovesPrx(address _collateral, uint _n) external {
        troveManager.liquidateTroves(_collateral, _n);
    }

    function batchLiquidateTrovesPrx(address _collateral, address[] calldata _troveArray) external {
        troveManager.batchLiquidateTroves(_collateral, _troveArray);
    }

    function redeemCollateralPrx(
        address _collateral,
        uint _LUSDAmount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        uint _maxIterations,
        uint _maxFee
    ) external {
        troveManager.redeemCollateral(_collateral, _LUSDAmount, _firstRedemptionHint, _upperPartialRedemptionHint, _lowerPartialRedemptionHint, _partialRedemptionHintNICR, _maxIterations, _maxFee);
    }

    // Borrower Operations
    function openTrovePrx(address _collateral, uint _collAmount, uint _LUSDAmount, address _upperHint, address _lowerHint, uint _maxFee) external {
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collAmount);
        IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), _collAmount);
        borrowerOperations.openTrove(_collateral, _collAmount, _maxFee, _LUSDAmount, _upperHint, _lowerHint);
    }

    function addCollPrx(address _collateral, uint _collAmount, address _upperHint, address _lowerHint) external {
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collAmount);
        IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), _collAmount);
        borrowerOperations.addColl(_collateral, _collAmount, _upperHint, _lowerHint);
    }

    function withdrawCollPrx(address _collateral, uint _amount, address _upperHint, address _lowerHint) external {
        borrowerOperations.withdrawColl(_collateral, _amount, _upperHint, _lowerHint);
    }

    function withdrawLUSDPrx(address _collateral, uint _amount, address _upperHint, address _lowerHint, uint _maxFee) external {
        borrowerOperations.withdrawLUSD(_collateral, _maxFee, _amount, _upperHint, _lowerHint);
    }

    function repayLUSDPrx(address _collateral, uint _amount, address _upperHint, address _lowerHint) external {
        borrowerOperations.repayLUSD(_collateral, _amount, _upperHint, _lowerHint);
    }

    function closeTrovePrx(address _collateral) external {
        borrowerOperations.closeTrove(_collateral);
    }

    function adjustTrovePrx(address _collateral, uint _collTopUp, uint _collWithdrawal, uint _debtChange, bool _isDebtIncrease, address _upperHint, address _lowerHint, uint _maxFee) external {
        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _collTopUp);
        IERC20(_collateral).safeIncreaseAllowance(address(borrowerOperations), _collTopUp);
        borrowerOperations.adjustTrove(_collateral, _maxFee, _collTopUp, _collWithdrawal, _debtChange, _isDebtIncrease, _upperHint, _lowerHint);
    }

    // Pool Manager
    function provideToSPPrx(uint _amount) external {
        stabilityPool.provideToSP(_amount);
    }

    function withdrawFromSPPrx(uint _amount) external {
        stabilityPool.withdrawFromSP(_amount);
    }

    // LUSD Token

    function transferPrx(address recipient, uint256 amount) external returns (bool) {
        return lusdToken.transfer(recipient, amount);
    }

    function approvePrx(address spender, uint256 amount) external returns (bool) {
        return lusdToken.approve(spender, amount);
    }

    function transferFromPrx(address sender, address recipient, uint256 amount) external returns (bool) {
        return lusdToken.transferFrom(sender, recipient, amount);
    }

    function increaseAllowancePrx(address spender, uint256 addedValue) external returns (bool) {
        return lusdToken.increaseAllowance(spender, addedValue);
    }

    function decreaseAllowancePrx(address spender, uint256 subtractedValue) external returns (bool) {
        return lusdToken.decreaseAllowance(spender, subtractedValue);
    }
}
