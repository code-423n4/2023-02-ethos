// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "./Interfaces/ICollateralConfig.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Dependencies/SafeMath.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/SafeERC20.sol";
import "./Dependencies/console.sol";

contract CollSurplusPool is Ownable, CheckContract, ICollSurplusPool {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    string constant public NAME = "CollSurplusPool";

    address public collateralConfigAddress;
    address public borrowerOperationsAddress;
    address public troveManagerAddress;
    address public activePoolAddress;

    // collateral => amount tracker
    mapping (address => uint256) internal collAmount;
    // Collateral surplus claimable by trove owners (address => collateral => amount)
    mapping (address => mapping (address => uint)) internal balances;

    // --- Events ---

    event CollateralConfigAddressChanged(address _newCollateralConfigAddress);
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
    )
        external
        override
        onlyOwner
    {
        checkContract(_collateralConfigAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_troveManagerAddress);
        checkContract(_activePoolAddress);

        collateralConfigAddress = _collateralConfigAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        troveManagerAddress = _troveManagerAddress;
        activePoolAddress = _activePoolAddress;

        emit CollateralConfigAddressChanged(_collateralConfigAddress);
        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);

        _renounceOwnership();
    }

    /* Returns the collAmount state variable.
       Not necessarily equal to the raw collateral balance - collateral can be forcibly sent to contracts. */
    function getCollateral(address _collateral) external view override returns (uint) {
        _requireValidCollateralAddress(_collateral);
        return collAmount[_collateral];
    }

    function getUserCollateral(address _account, address _collateral) external view override returns (uint) {
        _requireValidCollateralAddress(_collateral);
        return balances[_account][_collateral];
    }

    // --- Pool functionality ---

    function accountSurplus(address _account, address _collateral, uint _amount) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsTroveManager();

        uint newAmount = balances[_account][_collateral].add(_amount);
        balances[_account][_collateral] = newAmount;

        emit CollBalanceUpdated(_account, _collateral, newAmount);
    }

    function claimColl(address _account, address _collateral) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsBorrowerOperations();
        uint claimableColl = balances[_account][_collateral];
        require(claimableColl > 0, "CollSurplusPool: No collateral available to claim");

        balances[_account][_collateral] = 0;
        emit CollBalanceUpdated(_account, _collateral, 0);

        collAmount[_collateral] = collAmount[_collateral].sub(claimableColl);
        emit CollateralSent(_collateral, _account, claimableColl);

        IERC20(_collateral).safeTransfer(_account, claimableColl);
    }

    function pullCollateralFromActivePool(address _collateral, uint _amount) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsActivePool();
        collAmount[_collateral] = collAmount[_collateral].add(_amount);

        IERC20(_collateral).safeTransferFrom(activePoolAddress, address(this), _amount);
    }

    // --- 'require' functions ---

    function _requireValidCollateralAddress(address _collateral) internal view {
        require(
            ICollateralConfig(collateralConfigAddress).isCollateralAllowed(_collateral),
            "Invalid collateral address"
        );
    }

    function _requireCallerIsBorrowerOperations() internal view {
        require(
            msg.sender == borrowerOperationsAddress,
            "CollSurplusPool: Caller is not Borrower Operations");
    }

    function _requireCallerIsTroveManager() internal view {
        require(
            msg.sender == troveManagerAddress,
            "CollSurplusPool: Caller is not TroveManager");
    }

    function _requireCallerIsActivePool() internal view {
        require(
            msg.sender == activePoolAddress,
            "CollSurplusPool: Caller is not Active Pool");
    }
}
