// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import './Interfaces/IActivePool.sol';
import "./Interfaces/ICollateralConfig.sol";
import './Interfaces/IDefaultPool.sol';
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ILQTYStaking.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ITroveManager.sol";
import "./Dependencies/SafeMath.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/console.sol";
import "./Dependencies/SafeERC20.sol";
import "./Dependencies/IERC4626.sol";

/*
 * The Active Pool holds the collateral and LUSD debt for each collateral (but not LUSD tokens) for all active troves.
 *
 * When a trove is liquidated, it's collateral and LUSD debt are transferred from the Active Pool, to either the
 * Stability Pool, the Default Pool, or both, depending on the liquidation conditions.
 *
 */
contract ActivePool is Ownable, CheckContract, IActivePool {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    string constant public NAME = "ActivePool";

    bool public addressesSet = false;
    address public collateralConfigAddress;
    address public borrowerOperationsAddress;
    address public troveManagerAddress;
    address public stabilityPoolAddress;
    address public defaultPoolAddress;
    address public collSurplusPoolAddress;
    address public treasuryAddress;
    address public lqtyStakingAddress;
    mapping (address => uint256) internal collAmount;  // collateral => amount tracker
    mapping (address => uint256) internal LUSDDebt;  // collateral => corresponding debt tracker

    mapping (address => uint256) public yieldingPercentage; // collateral => % to use for yield farming (in BPS, <= 10k)
    mapping (address => uint256) public yieldingAmount; // collateral => actual wei amount being used for yield farming
    mapping (address => address) public yieldGenerator; // collateral => corresponding ERC4626 vault
    mapping (address => uint256) public yieldClaimThreshold; // collateral => minimum wei amount of yield to claim and redistribute
    
    uint256 public yieldingPercentageDrift = 100; // rebalance iff % is off by more than 100 BPS

    // Yield distribution params, must add up to 10k
    uint256 public yieldSplitTreasury = 20_00; // amount of yield to direct to treasury in BPS
    uint256 public yieldSplitSP = 40_00; // amount of yield to direct to stability pool in BPS
    uint256 public yieldSplitStaking = 40_00; // amount of yield to direct to OATH Stakers in BPS

    // --- Events ---

    event CollateralConfigAddressChanged(address _newCollateralConfigAddress);
    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
    event ActivePoolLUSDDebtUpdated(address _collateral, uint _LUSDDebt);
    event ActivePoolCollateralBalanceUpdated(address _collateral, uint _amount);
    event YieldingPercentageUpdated(address _collateral, uint256 _bps);
    event YieldingPercentageDriftUpdated(uint256 _driftBps);
    event YieldClaimThresholdUpdated(address _collateral, uint256 _threshold);
    event YieldDistributionParamsUpdated(uint256 _treasurySplit, uint256 _SPSplit, uint256 _stakingSplit);

    // --- Contract setters ---

    function setAddresses(
        address _collateralConfigAddress,
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _stabilityPoolAddress,
        address _defaultPoolAddress,
        address _collSurplusPoolAddress,
        address _treasuryAddress,
        address _lqtyStakingAddress,
        address[] calldata _erc4626vaults
    )
        external
        onlyOwner
    {
        require(!addressesSet, "Can call setAddresses only once");

        checkContract(_collateralConfigAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_troveManagerAddress);
        checkContract(_stabilityPoolAddress);
        checkContract(_defaultPoolAddress);
        checkContract(_collSurplusPoolAddress);
        require(_treasuryAddress != address(0), "Treasury cannot be 0 address");
        checkContract(_lqtyStakingAddress);

        collateralConfigAddress = _collateralConfigAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        troveManagerAddress = _troveManagerAddress;
        stabilityPoolAddress = _stabilityPoolAddress;
        defaultPoolAddress = _defaultPoolAddress;
        collSurplusPoolAddress = _collSurplusPoolAddress;
        treasuryAddress = _treasuryAddress;
        lqtyStakingAddress = _lqtyStakingAddress;

        address[] memory collaterals = ICollateralConfig(collateralConfigAddress).getAllowedCollaterals();
        uint256 numCollaterals = collaterals.length;
        require(numCollaterals == _erc4626vaults.length, "Vaults array length must match number of collaterals");
        for(uint256 i = 0; i < numCollaterals; i++) {
            address collateral = collaterals[i];
            address vault = _erc4626vaults[i];
            require(IERC4626(vault).asset() == collateral, "Vault asset must be collateral");
            yieldGenerator[collateral] = vault;
        }

        emit CollateralConfigAddressChanged(_collateralConfigAddress);
        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit StabilityPoolAddressChanged(_stabilityPoolAddress);
        emit DefaultPoolAddressChanged(_defaultPoolAddress);
        emit CollSurplusPoolAddressChanged(_collSurplusPoolAddress);

        addressesSet = true;
    }

    function setYieldingPercentage(address _collateral, uint256 _bps) external onlyOwner {
        _requireValidCollateralAddress(_collateral);
        require(_bps <= 10_000, "Invalid BPS value");
        yieldingPercentage[_collateral] = _bps;
        emit YieldingPercentageUpdated(_collateral, _bps);
    }

    function setYieldingPercentageDrift(uint256 _driftBps) external onlyOwner {
        require(_driftBps <= 500, "Exceeds max allowed value of 500 BPS");
        yieldingPercentageDrift = _driftBps;
        emit YieldingPercentageDriftUpdated(_driftBps);
    }

    function setYieldClaimThreshold(address _collateral, uint256 _threshold) external onlyOwner {
        _requireValidCollateralAddress(_collateral);
        yieldClaimThreshold[_collateral] = _threshold;
        emit YieldClaimThresholdUpdated(_collateral, _threshold);
    }

    function setYieldDistributionParams(uint256 _treasurySplit, uint256 _SPSplit, uint256 _stakingSplit) external onlyOwner {
        require(_treasurySplit + _SPSplit + _stakingSplit == 10_000, "Splits must add up to 10000 BPS");
        yieldSplitTreasury = _treasurySplit;
        yieldSplitSP = _SPSplit;
        yieldSplitStaking = _stakingSplit;
        emit YieldDistributionParamsUpdated(_treasurySplit, _SPSplit, _stakingSplit);
    }

    // --- Getters for public variables. Required by IPool interface ---

    /*
    * Returns the collAmount state variable.
    *
    *Not necessarily equal to the the contract's raw collateral balance - collateral can be forcibly sent to contracts.
    */
    function getCollateral(address _collateral) external view override returns (uint) {
        _requireValidCollateralAddress(_collateral);
        return collAmount[_collateral];
    }

    function getLUSDDebt(address _collateral) external view override returns (uint) {
        _requireValidCollateralAddress(_collateral);
        return LUSDDebt[_collateral];
    }

    // --- Pool functionality ---

    function sendCollateral(address _collateral, address _account, uint _amount) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsBOorTroveMorSP();
        _rebalance(_collateral, _amount);
        collAmount[_collateral] = collAmount[_collateral].sub(_amount);
        emit ActivePoolCollateralBalanceUpdated(_collateral, collAmount[_collateral]);
        emit CollateralSent(_collateral, _account, _amount);

        if (_account == defaultPoolAddress) {
            IERC20(_collateral).safeIncreaseAllowance(defaultPoolAddress, _amount);
            IDefaultPool(defaultPoolAddress).pullCollateralFromActivePool(_collateral, _amount);
        } else if (_account == collSurplusPoolAddress) {
            IERC20(_collateral).safeIncreaseAllowance(collSurplusPoolAddress, _amount);
            ICollSurplusPool(collSurplusPoolAddress).pullCollateralFromActivePool(_collateral, _amount);
        } else {
            IERC20(_collateral).safeTransfer(_account, _amount);
        }
    }

    function increaseLUSDDebt(address _collateral, uint _amount) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsBOorTroveM();
        LUSDDebt[_collateral] = LUSDDebt[_collateral].add(_amount);
        ActivePoolLUSDDebtUpdated(_collateral, LUSDDebt[_collateral]);
    }

    function decreaseLUSDDebt(address _collateral, uint _amount) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsBOorTroveMorSP();
        LUSDDebt[_collateral] = LUSDDebt[_collateral].sub(_amount);
        ActivePoolLUSDDebtUpdated(_collateral, LUSDDebt[_collateral]);
    }

    function pullCollateralFromBorrowerOperationsOrDefaultPool(address _collateral, uint _amount) external override {
        _requireValidCollateralAddress(_collateral);
        _requireCallerIsBorrowerOperationsOrDefaultPool();
        collAmount[_collateral] = collAmount[_collateral].add(_amount);
        emit ActivePoolCollateralBalanceUpdated(_collateral, collAmount[_collateral]);

        IERC20(_collateral).safeTransferFrom(msg.sender, address(this), _amount);
        _rebalance(_collateral, 0);
    }

    function manualRebalance(address _collateral, uint256 _simulatedAmountLeavingPool) external onlyOwner {
        _requireValidCollateralAddress(_collateral);
        _rebalance(_collateral, _simulatedAmountLeavingPool);
    }

    // Due to "stack too deep" error
    struct LocalVariables_rebalance {
        uint256 currentAllocated;
        IERC4626 yieldGenerator;
        uint256 ownedShares;
        uint256 sharesToAssets;
        uint256 profit;
        uint256 finalBalance;
        uint256 percentOfFinalBal;
        uint256 yieldingPercentage;
        uint256 toDeposit;
        uint256 toWithdraw;
        uint256 yieldingAmount;
        uint256 finalYieldingAmount;
        int256 netAssetMovement;
        uint256 treasurySplit;
        uint256 stakingSplit;
        uint256 stabilityPoolSplit;
    }

    function _rebalance(address _collateral, uint256 _amountLeavingPool) internal {
        LocalVariables_rebalance memory vars;

        // how much has been allocated as per our internal records?
        vars.currentAllocated = yieldingAmount[_collateral];
        
        // what is the present value of our shares?
        vars.yieldGenerator = IERC4626(yieldGenerator[_collateral]);
        vars.ownedShares = vars.yieldGenerator.balanceOf(address(this));
        vars.sharesToAssets = vars.yieldGenerator.convertToAssets(vars.ownedShares);

        // if we have profit that's more than the threshold, record it for withdrawal and redistribution
        vars.profit = vars.sharesToAssets.sub(vars.currentAllocated);
        if (vars.profit < yieldClaimThreshold[_collateral]) {
            vars.profit = 0;
        }
        
        // what % of the final pool balance would the current allocation be?
        vars.finalBalance = collAmount[_collateral].sub(_amountLeavingPool);
        vars.percentOfFinalBal = vars.finalBalance == 0 ? uint256(-1) : vars.currentAllocated.mul(10_000).div(vars.finalBalance);

        // if abs(percentOfFinalBal - yieldingPercentage) > drift, we will need to deposit more or withdraw some
        vars.yieldingPercentage = yieldingPercentage[_collateral];
        vars.finalYieldingAmount = vars.finalBalance.mul(vars.yieldingPercentage).div(10_000);
        vars.yieldingAmount = yieldingAmount[_collateral];
        if (vars.percentOfFinalBal > vars.yieldingPercentage && vars.percentOfFinalBal.sub(vars.yieldingPercentage) > yieldingPercentageDrift) {
            // we will end up overallocated, withdraw some
            vars.toWithdraw = vars.currentAllocated.sub(vars.finalYieldingAmount);
            vars.yieldingAmount = vars.yieldingAmount.sub(vars.toWithdraw);
            yieldingAmount[_collateral] = vars.yieldingAmount;
        } else if(vars.percentOfFinalBal < vars.yieldingPercentage && vars.yieldingPercentage.sub(vars.percentOfFinalBal) > yieldingPercentageDrift) {
            // we will end up underallocated, deposit more
            vars.toDeposit = vars.finalYieldingAmount.sub(vars.currentAllocated);
            vars.yieldingAmount = vars.yieldingAmount.add(vars.toDeposit);
            yieldingAmount[_collateral] = vars.yieldingAmount;
        }

        // + means deposit, - means withdraw
        vars.netAssetMovement = int256(vars.toDeposit) - int256(vars.toWithdraw) - int256(vars.profit);
        if (vars.netAssetMovement > 0) {
            IERC20(_collateral).safeIncreaseAllowance(yieldGenerator[_collateral], uint256(vars.netAssetMovement));
            IERC4626(yieldGenerator[_collateral]).deposit(uint256(vars.netAssetMovement), address(this));
        } else if (vars.netAssetMovement < 0) {
            IERC4626(yieldGenerator[_collateral]).withdraw(uint256(-vars.netAssetMovement), address(this), address(this));
        }

        // if we recorded profit, recalculate it for precision and distribute
        if (vars.profit != 0) {
            // profit is ultimately (coll at hand) + (coll allocated to yield generator) - (recorded total coll Amount in pool)
            vars.profit = IERC20(_collateral).balanceOf(address(this)).add(vars.yieldingAmount).sub(collAmount[_collateral]);
            if (vars.profit != 0) {
                // distribute to treasury, staking pool, and stability pool
                vars.treasurySplit = vars.profit.mul(yieldSplitTreasury).div(10_000);
                if (vars.treasurySplit != 0) {
                    IERC20(_collateral).safeTransfer(treasuryAddress, vars.treasurySplit);
                }

                vars.stakingSplit = vars.profit.mul(yieldSplitStaking).div(10_000);
                if (vars.stakingSplit != 0) {
                    IERC20(_collateral).safeTransfer(lqtyStakingAddress, vars.stakingSplit);
                    ILQTYStaking(lqtyStakingAddress).increaseF_Collateral(_collateral, vars.stakingSplit);
                }

                vars.stabilityPoolSplit = vars.profit.sub(vars.treasurySplit.add(vars.stakingSplit));
                if (vars.stabilityPoolSplit != 0) {
                    IERC20(_collateral).safeTransfer(stabilityPoolAddress, vars.stabilityPoolSplit);
                    IStabilityPool(stabilityPoolAddress).updateRewardSum(_collateral, vars.stabilityPoolSplit);   
                }
            }
        }
    }

    // --- 'require' functions ---

    function _requireValidCollateralAddress(address _collateral) internal view {
        require(
            ICollateralConfig(collateralConfigAddress).isCollateralAllowed(_collateral),
            "Invalid collateral address"
        );
    }

    function _requireCallerIsBorrowerOperationsOrDefaultPool() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == defaultPoolAddress,
            "ActivePool: Caller is neither BO nor Default Pool");
    }

    function _requireCallerIsBOorTroveMorSP() internal view {
        address redemptionHelper = address(ITroveManager(troveManagerAddress).redemptionHelper());
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress ||
            msg.sender == redemptionHelper ||
            msg.sender == stabilityPoolAddress,
            "ActivePool: Caller is neither BorrowerOperations nor TroveManager nor StabilityPool");
    }

    function _requireCallerIsBOorTroveM() internal view {
        require(
            msg.sender == borrowerOperationsAddress ||
            msg.sender == troveManagerAddress,
            "ActivePool: Caller is neither BorrowerOperations nor TroveManager");
    }
}
