// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../Dependencies/BaseMath.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/console.sol";
import "../Dependencies/IERC20.sol";
import "../Interfaces/ICollateralConfig.sol";
import "../Interfaces/ILQTYStaking.sol";
import "../Interfaces/ITroveManager.sol";
import "../Dependencies/LiquityMath.sol";
import "../Interfaces/ILUSDToken.sol";
import "../Dependencies/SafeERC20.sol";

contract LQTYStaking is ILQTYStaking, Ownable, CheckContract, BaseMath {
    using SafeERC20 for IERC20;
    using SafeMath for uint;

    // --- Data ---
    string constant public NAME = "LQTYStaking";

    mapping( address => uint) public stakes;
    uint public totalLQTYStaked;

    mapping (address => uint) public F_Collateral;  // Running sum of collateral fees per-LQTY-staked
    uint public F_LUSD; // Running sum of LUSD fees per-LQTY-staked

    // User snapshots of F_Collateral and F_LUSD, taken at the point at which their latest deposit was made
    mapping (address => Snapshot) public snapshots; 

    struct Snapshot {
        mapping (address => uint) F_Collateral_Snapshot;
        uint F_LUSD_Snapshot;
    }
    
    IERC20 public lqtyToken;
    ILUSDToken public lusdToken;
    ICollateralConfig public collateralConfig;

    address public troveManagerAddress;
    address public borrowerOperationsAddress;
    address public activePoolAddress;

    // --- Events ---

    event LQTYTokenAddressSet(address _lqtyTokenAddress);
    event LUSDTokenAddressSet(address _lusdTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event ActivePoolAddressSet(address _activePoolAddress);
    event CollateralConfigAddressSet(address _collateralConfigAddress);

    event StakeChanged(address indexed staker, uint newStake);
    event StakingGainsWithdrawn(address indexed staker, uint LUSDGain, address[] _assets, uint[] _amounts);
    event F_CollateralUpdated(address _collateral, uint _F_Collateral);
    event F_LUSDUpdated(uint _F_LUSD);
    event TotalLQTYStakedUpdated(uint _totalLQTYStaked);
    event CollateralSent(address _account, address _collateral, uint _amount);
    event StakerSnapshotsUpdated(address _staker, address[] _assets, uint[] _amounts, uint _F_LUSD);

    // --- Functions ---

    function setAddresses
    (
        address _lqtyTokenAddress,
        address _lusdTokenAddress,
        address _troveManagerAddress, 
        address _borrowerOperationsAddress,
        address _activePoolAddress,
        address _collateralConfigAddress
    ) 
        external 
        onlyOwner 
        override 
    {
        checkContract(_lqtyTokenAddress);
        checkContract(_lusdTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_activePoolAddress);
        checkContract(_collateralConfigAddress);

        lqtyToken = IERC20(_lqtyTokenAddress);
        lusdToken = ILUSDToken(_lusdTokenAddress);
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        activePoolAddress = _activePoolAddress;
        collateralConfig = ICollateralConfig(_collateralConfigAddress);

        emit LQTYTokenAddressSet(_lqtyTokenAddress);
        emit LQTYTokenAddressSet(_lusdTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit ActivePoolAddressSet(_activePoolAddress);
        emit CollateralConfigAddressSet(_collateralConfigAddress);

        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated collateral and LUSD gains to them. 
    function stake(uint _LQTYamount) external override {
        _requireNonZeroAmount(_LQTYamount);

        uint currentStake = stakes[msg.sender];

        address[] memory collGainAssets;
        uint[] memory collGainAmounts;
        uint LUSDGain;
        // Grab any accumulated collateral and LUSD gains from the current stake
        if (currentStake != 0) {
            (collGainAssets, collGainAmounts) = _getPendingCollateralGain(msg.sender);
            LUSDGain = _getPendingLUSDGain(msg.sender);
        }
    
       _updateUserSnapshots(msg.sender);

        uint newStake = currentStake.add(_LQTYamount);

        // Increase user’s stake and total LQTY staked
        stakes[msg.sender] = newStake;
        totalLQTYStaked = totalLQTYStaked.add(_LQTYamount);
        emit TotalLQTYStakedUpdated(totalLQTYStaked);

        // Transfer LQTY from caller to this contract
        lqtyToken.safeTransferFrom(msg.sender, address(this), _LQTYamount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, LUSDGain, collGainAssets, collGainAmounts);

         // Send accumulated LUSD and collateral gains to the caller
        if (currentStake != 0) {
            lusdToken.transfer(msg.sender, LUSDGain);
            _sendCollGainToUser(collGainAssets, collGainAmounts);
        }
    }

    // Unstake the LQTY and send the it back to the caller, along with their accumulated LUSD & collateral gains.
    // If requested amount > stake, send their entire stake.
    function unstake(uint _LQTYamount) external override {
        uint currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated ETH and LUSD gains from the current stake
        (address[] memory collGainAssets, uint[] memory collGainAmounts) = _getPendingCollateralGain(msg.sender);
        uint LUSDGain = _getPendingLUSDGain(msg.sender);
        
        _updateUserSnapshots(msg.sender);

        if (_LQTYamount > 0) {
            uint LQTYToWithdraw = LiquityMath._min(_LQTYamount, currentStake);

            uint newStake = currentStake.sub(LQTYToWithdraw);

            // Decrease user's stake and total LQTY staked
            stakes[msg.sender] = newStake;
            totalLQTYStaked = totalLQTYStaked.sub(LQTYToWithdraw);
            emit TotalLQTYStakedUpdated(totalLQTYStaked);

            // Transfer unstaked LQTY to user
            lqtyToken.safeTransfer(msg.sender, LQTYToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, LUSDGain, collGainAssets, collGainAmounts);

        // Send accumulated LUSD and ETH gains to the caller
        lusdToken.transfer(msg.sender, LUSDGain);
        _sendCollGainToUser(collGainAssets, collGainAmounts);
    }

    // --- Reward-per-unit-staked increase functions. Called by Liquity core contracts ---

    function increaseF_Collateral(address _collateral, uint _collFee) external override {
        _requireCallerIsTroveManagerOrActivePool();
        uint collFeePerLQTYStaked;
     
        if (totalLQTYStaked > 0) {collFeePerLQTYStaked = _collFee.mul(DECIMAL_PRECISION).div(totalLQTYStaked);}

        F_Collateral[_collateral] = F_Collateral[_collateral].add(collFeePerLQTYStaked);
        emit F_CollateralUpdated(_collateral, F_Collateral[_collateral]);
    }

    function increaseF_LUSD(uint _LUSDFee) external override {
        _requireCallerIsBorrowerOperations();
        uint LUSDFeePerLQTYStaked;
        
        if (totalLQTYStaked > 0) {LUSDFeePerLQTYStaked = _LUSDFee.mul(DECIMAL_PRECISION).div(totalLQTYStaked);}
        
        F_LUSD = F_LUSD.add(LUSDFeePerLQTYStaked);
        emit F_LUSDUpdated(F_LUSD);
    }

    // --- Pending reward functions ---

    function getPendingCollateralGain(address _user) external view override returns (address[] memory, uint[] memory) {
        return _getPendingCollateralGain(_user);
    }

    function _getPendingCollateralGain(address _user) internal view returns (address[] memory assets, uint[] memory amounts) {
        assets = collateralConfig.getAllowedCollaterals();
        amounts = new uint[](assets.length);
        for (uint i = 0; i < assets.length; i++) {
            address collateral = assets[i];
            uint F_Collateral_Snapshot = snapshots[_user].F_Collateral_Snapshot[collateral];
            amounts[i] = stakes[_user].mul(F_Collateral[collateral].sub(F_Collateral_Snapshot)).div(DECIMAL_PRECISION);
        }
    }

    function getPendingLUSDGain(address _user) external view override returns (uint) {
        return _getPendingLUSDGain(_user);
    }

    function _getPendingLUSDGain(address _user) internal view returns (uint) {
        uint F_LUSD_Snapshot = snapshots[_user].F_LUSD_Snapshot;
        uint LUSDGain = stakes[_user].mul(F_LUSD.sub(F_LUSD_Snapshot)).div(DECIMAL_PRECISION);
        return LUSDGain;
    }

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
        address[] memory collaterals = collateralConfig.getAllowedCollaterals();
        uint[] memory amounts = new uint[](collaterals.length);
        for (uint i = 0; i < collaterals.length; i++) {
            address collateral = collaterals[i];
            snapshots[_user].F_Collateral_Snapshot[collateral] = F_Collateral[collateral];
            amounts[i] = F_Collateral[collateral];
        }
        uint fLUSD = F_LUSD;
        snapshots[_user].F_LUSD_Snapshot = fLUSD;
        emit StakerSnapshotsUpdated(_user, collaterals, amounts, fLUSD);
    }

    function _sendCollGainToUser(address[] memory assets, uint[] memory amounts) internal {
        uint numCollaterals = assets.length;
        for (uint i = 0; i < numCollaterals; i++) {
            if (amounts[i] != 0) {
                address collateral = assets[i];
                emit CollateralSent(msg.sender, collateral, amounts[i]);
                IERC20(collateral).safeTransfer(msg.sender, amounts[i]);
            }
        }
    }

    // --- 'require' functions ---

    function _requireCallerIsTroveManagerOrActivePool() internal view {
        address redemptionHelper = address(ITroveManager(troveManagerAddress).redemptionHelper());
        require(
            msg.sender == troveManagerAddress ||
            msg.sender == redemptionHelper ||
            msg.sender == activePoolAddress,
            "LQTYStaking: caller is not TroveM or ActivePool"
        );
    }

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress, "LQTYStaking: caller is not BorrowerOps");
    }

    function _requireUserHasStake(uint currentStake) internal pure {  
        require(currentStake > 0, 'LQTYStaking: User must have a non-zero stake');  
    }

    function _requireNonZeroAmount(uint _amount) internal pure {
        require(_amount > 0, 'LQTYStaking: Amount must be non-zero');
    }
}
