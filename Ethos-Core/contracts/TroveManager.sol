// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "./Interfaces/ICollateralConfig.sol";
import "./Interfaces/ITroveManager.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICollSurplusPool.sol";
import "./Interfaces/ILUSDToken.sol";
import "./Interfaces/ISortedTroves.sol";
import "./Interfaces/ILQTYStaking.sol";
import "./Interfaces/IRedemptionHelper.sol";
import "./Dependencies/LiquityBase.sol";
// import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/IERC20.sol";

contract TroveManager is LiquityBase, /*Ownable,*/ CheckContract, ITroveManager {
    // string constant public NAME = "TroveManager";

    address public owner;

    // --- Connected contract declarations ---

    address public borrowerOperationsAddress;

    ICollateralConfig public collateralConfig;

    IStabilityPool public override stabilityPool;

    address gasPoolAddress;

    ICollSurplusPool collSurplusPool;

    ILUSDToken public override lusdToken;

    IERC20 public override lqtyToken;

    ILQTYStaking public override lqtyStaking;

    // A doubly linked list of Troves, sorted by their sorted by their collateral ratios
    ISortedTroves public sortedTroves;

    IRedemptionHelper public override redemptionHelper;

    // --- Data structures ---

    uint constant public SECONDS_IN_ONE_MINUTE = 60;
    /*
     * Half-life of 12h. 12h = 720 min
     * (1/2) = d^720 => d = (1/2)^(1/720)
     */
    uint constant public MINUTE_DECAY_FACTOR = 999037758833783000;
    uint constant public override REDEMPTION_FEE_FLOOR = DECIMAL_PRECISION / 1000 * 5; // 0.5%
    uint constant public MAX_BORROWING_FEE = DECIMAL_PRECISION / 100 * 5; // 5%

    /*
    * BETA: 18 digit decimal. Parameter by which to divide the redeemed fraction, in order to calc the new base rate from a redemption.
    * Corresponds to (1 / ALPHA) in the white paper.
    */
    uint constant public BETA = 2;

    uint public baseRate;

    // The timestamp of the latest fee operation (redemption or new LUSD issuance)
    uint public lastFeeOperationTime;

    enum Status {
        nonExistent,
        active,
        closedByOwner,
        closedByLiquidation,
        closedByRedemption
    }

    // Store the necessary data for a trove
    struct Trove {
        uint debt;
        uint coll;
        uint stake;
        Status status;
        uint128 arrayIndex;
    }

    // user => (collateral type => trove)
    mapping (address => mapping (address => Trove)) public Troves;

    mapping (address => uint) public totalStakes;

    // Snapshot of the value of totalStakes for each collateral, taken immediately after the latest liquidation
    mapping (address => uint) public totalStakesSnapshot;

    // Snapshot of the total collateral across the ActivePool and DefaultPool, immediately after the latest liquidation.
    mapping (address => uint) public totalCollateralSnapshot;

    /*
    * L_Collateral and L_LUSDDebt track the sums of accumulated liquidation rewards per unit staked. During its lifetime, each stake earns:
    *
    * A collateral gain of ( stake * [L_Collateral - L_Collateral(0)] )
    * A LUSDDebt increase  of ( stake * [L_LUSDDebt - L_LUSDDebt(0)] )
    *
    * Where L_Collateral(0) and L_LUSDDebt(0) are snapshots of L_Collateral and L_LUSDDebt for the active Trove taken at the instant the stake was made
    */
    mapping (address => uint) public L_Collateral;
    mapping (address => uint) public L_LUSDDebt;

    // Map addresses with active troves to their RewardSnapshot
    // user => (collateral type => reward snapshot))
    mapping (address => mapping (address => RewardSnapshot)) public rewardSnapshots;

    // Object containing the Collateral and LUSD snapshots for a given active trove
    struct RewardSnapshot { uint collAmount; uint LUSDDebt;}

    // Array of all active trove addresses - used to to compute an approximate hint off-chain, for the sorted list insertion
    // collateral type => array of trove owners
    mapping (address => address[]) public TroveOwners;

    // Error trackers for the trove redistribution calculation
    mapping (address => uint) public lastCollateralError_Redistribution;
    mapping (address => uint) public lastLUSDDebtError_Redistribution;

    /*
    * --- Variable container structs for liquidations ---
    *
    * These structs are used to hold, return and assign variables inside the liquidation functions,
    * in order to avoid the error: "CompilerError: Stack too deep".
    **/

    struct LocalVariables_OuterLiquidationFunction {
        uint256 collDecimals;
        uint256 collCCR;
        uint256 collMCR;
        uint price;
        uint LUSDInStabPool;
        bool recoveryModeAtStart;
        uint liquidatedDebt;
        uint liquidatedColl;
    }

    struct LocalVariables_InnerSingleLiquidateFunction {
        uint collToLiquidate;
        uint pendingDebtReward;
        uint pendingCollReward;
    }

    struct LocalVariables_LiquidationSequence {
        uint remainingLUSDInStabPool;
        uint i;
        uint ICR;
        uint TCR;
        address user;
        bool backToNormalMode;
        uint entireSystemDebt;
        uint entireSystemColl;
        uint256 collDecimals;
        uint256 collCCR;
        uint256 collMCR;
    }

    struct LiquidationValues {
        uint entireTroveDebt;
        uint entireTroveColl;
        uint collGasCompensation;
        uint LUSDGasCompensation;
        uint debtToOffset;
        uint collToSendToSP;
        uint debtToRedistribute;
        uint collToRedistribute;
        uint collSurplus;
    }

    struct LiquidationTotals {
        uint totalCollInSequence;
        uint totalDebtInSequence;
        uint totalCollGasCompensation;
        uint totalLUSDGasCompensation;
        uint totalDebtToOffset;
        uint totalCollToSendToSP;
        uint totalDebtToRedistribute;
        uint totalCollToRedistribute;
        uint totalCollSurplus;
    }

    // --- Events ---

    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event CollateralConfigAddressChanged(address _newCollateralConfigAddress);
    event PriceFeedAddressChanged(address _newPriceFeedAddress);
    event LUSDTokenAddressChanged(address _newLUSDTokenAddress);
    event ActivePoolAddressChanged(address _activePoolAddress);
    event DefaultPoolAddressChanged(address _defaultPoolAddress);
    event StabilityPoolAddressChanged(address _stabilityPoolAddress);
    event GasPoolAddressChanged(address _gasPoolAddress);
    event CollSurplusPoolAddressChanged(address _collSurplusPoolAddress);
    event SortedTrovesAddressChanged(address _sortedTrovesAddress);
    event LQTYTokenAddressChanged(address _lqtyTokenAddress);
    event LQTYStakingAddressChanged(address _lqtyStakingAddress);
    event RedemptionHelperAddressChanged(address _redemptionHelperAddress);

    event Liquidation(address _collateral, uint _liquidatedDebt, uint _liquidatedColl, uint _collGasCompensation, uint _LUSDGasCompensation);
    event TroveUpdated(address indexed _borrower, address _collateral, uint _debt, uint _coll, uint _stake, TroveManagerOperation _operation);
    event TroveLiquidated(address indexed _borrower, address _collateral, uint _debt, uint _coll, TroveManagerOperation _operation);
    event BaseRateUpdated(uint _baseRate);
    event LastFeeOpTimeUpdated(uint _lastFeeOpTime);
    event TotalStakesUpdated(address _collateral, uint _newTotalStakes);
    event SystemSnapshotsUpdated(address _collateral, uint _totalStakesSnapshot, uint _totalCollateralSnapshot);
    event LTermsUpdated(address _collateral, uint _L_Collateral, uint _L_LUSDDebt);
    event TroveSnapshotsUpdated(address _collateral, uint _L_Collateral, uint _L_LUSDDebt);
    event TroveIndexUpdated(address _borrower, address _collateral, uint _newIndex);
    event Redemption(
        address _collateral,
        uint _attemptedLUSDAmount,
        uint _actualLUSDAmount,
        uint _collSent,
        uint _collFee
    );

     enum TroveManagerOperation {
        applyPendingRewards,
        liquidateInNormalMode,
        liquidateInRecoveryMode,
        redeemCollateral
    }

    constructor() public {
        // makeshift ownable implementation to circumvent contract size limit
        owner = msg.sender;
    }

    // --- Dependency setter ---

    function setAddresses(
        address _borrowerOperationsAddress,
        address _collateralConfigAddress,
        address _activePoolAddress,
        address _defaultPoolAddress,
        address _stabilityPoolAddress,
        address _gasPoolAddress,
        address _collSurplusPoolAddress,
        address _priceFeedAddress,
        address _lusdTokenAddress,
        address _sortedTrovesAddress,
        address _lqtyTokenAddress,
        address _lqtyStakingAddress,
        address _redemptionHelperAddress
    )
        external
        override
    {
        require(msg.sender == owner);

        checkContract(_borrowerOperationsAddress);
        checkContract(_collateralConfigAddress);
        checkContract(_activePoolAddress);
        checkContract(_defaultPoolAddress);
        checkContract(_stabilityPoolAddress);
        checkContract(_gasPoolAddress);
        checkContract(_collSurplusPoolAddress);
        checkContract(_priceFeedAddress);
        checkContract(_lusdTokenAddress);
        checkContract(_sortedTrovesAddress);
        checkContract(_lqtyTokenAddress);
        checkContract(_lqtyStakingAddress);
        checkContract(_redemptionHelperAddress);

        borrowerOperationsAddress = _borrowerOperationsAddress;
        collateralConfig = ICollateralConfig(_collateralConfigAddress);
        activePool = IActivePool(_activePoolAddress);
        defaultPool = IDefaultPool(_defaultPoolAddress);
        stabilityPool = IStabilityPool(_stabilityPoolAddress);
        gasPoolAddress = _gasPoolAddress;
        collSurplusPool = ICollSurplusPool(_collSurplusPoolAddress);
        priceFeed = IPriceFeed(_priceFeedAddress);
        lusdToken = ILUSDToken(_lusdTokenAddress);
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
        lqtyToken = IERC20(_lqtyTokenAddress);
        lqtyStaking = ILQTYStaking(_lqtyStakingAddress);
        redemptionHelper = IRedemptionHelper(_redemptionHelperAddress);

        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit CollateralConfigAddressChanged(_collateralConfigAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);
        emit DefaultPoolAddressChanged(_defaultPoolAddress);
        emit StabilityPoolAddressChanged(_stabilityPoolAddress);
        emit GasPoolAddressChanged(_gasPoolAddress);
        emit CollSurplusPoolAddressChanged(_collSurplusPoolAddress);
        emit PriceFeedAddressChanged(_priceFeedAddress);
        emit LUSDTokenAddressChanged(_lusdTokenAddress);
        emit SortedTrovesAddressChanged(_sortedTrovesAddress);
        emit LQTYTokenAddressChanged(_lqtyTokenAddress);
        emit LQTYStakingAddressChanged(_lqtyStakingAddress);
        emit RedemptionHelperAddressChanged(_redemptionHelperAddress);

        owner = address(0);
    }

    // --- Getters ---

    function getTroveOwnersCount(address _collateral) external view override returns (uint) {
        return TroveOwners[_collateral].length;
    }

    function getTroveFromTroveOwnersArray(address _collateral, uint _index) external view override returns (address) {
        return TroveOwners[_collateral][_index];
    }

    // --- Trove Liquidation functions ---

    // Single liquidation function. Closes the trove if its ICR is lower than the minimum collateral ratio.
    function liquidate(address _borrower, address _collateral) external override {
        _requireTroveIsActive(_borrower, _collateral);

        address[] memory borrowers = new address[](1);
        borrowers[0] = _borrower;
        batchLiquidateTroves(_collateral, borrowers);
    }

    // --- Inner single liquidation functions ---

    // Liquidate one trove, in Normal Mode.
    function _liquidateNormalMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _collateral,
        address _borrower,
        uint _LUSDInStabPool
    )
        internal
        returns (LiquidationValues memory singleLiquidation)
    {
        LocalVariables_InnerSingleLiquidateFunction memory vars;

        (singleLiquidation.entireTroveDebt,
        singleLiquidation.entireTroveColl,
        vars.pendingDebtReward,
        vars.pendingCollReward) = getEntireDebtAndColl(_borrower, _collateral);

        _movePendingTroveRewardsToActivePool(_activePool, _defaultPool, _collateral, vars.pendingDebtReward, vars.pendingCollReward);
        _removeStake(_borrower, _collateral);

        singleLiquidation.collGasCompensation = _getCollGasCompensation(singleLiquidation.entireTroveColl);
        singleLiquidation.LUSDGasCompensation = LUSD_GAS_COMPENSATION;
        uint collToLiquidate = singleLiquidation.entireTroveColl.sub(singleLiquidation.collGasCompensation);

        (singleLiquidation.debtToOffset,
        singleLiquidation.collToSendToSP,
        singleLiquidation.debtToRedistribute,
        singleLiquidation.collToRedistribute) = _getOffsetAndRedistributionVals(singleLiquidation.entireTroveDebt, collToLiquidate, _LUSDInStabPool);

        _closeTrove(_borrower, _collateral, Status.closedByLiquidation);
        emit TroveLiquidated(_borrower, _collateral, singleLiquidation.entireTroveDebt, singleLiquidation.entireTroveColl, TroveManagerOperation.liquidateInNormalMode);
        emit TroveUpdated(_borrower, _collateral, 0, 0, 0, TroveManagerOperation.liquidateInNormalMode);
        return singleLiquidation;
    }

    // Liquidate one trove, in Recovery Mode.
    function _liquidateRecoveryMode(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _collateral,
        address _borrower,
        uint _ICR,
        uint _LUSDInStabPool,
        uint _TCR,
        uint _price,
        uint256 _MCR
    )
        internal
        returns (LiquidationValues memory singleLiquidation)
    {
        LocalVariables_InnerSingleLiquidateFunction memory vars;
        if (TroveOwners[_collateral].length <= 1) {return singleLiquidation;} // don't liquidate if last trove
        (singleLiquidation.entireTroveDebt,
        singleLiquidation.entireTroveColl,
        vars.pendingDebtReward,
        vars.pendingCollReward) = getEntireDebtAndColl(_borrower, _collateral);

        singleLiquidation.collGasCompensation = _getCollGasCompensation(singleLiquidation.entireTroveColl);
        singleLiquidation.LUSDGasCompensation = LUSD_GAS_COMPENSATION;
        vars.collToLiquidate = singleLiquidation.entireTroveColl.sub(singleLiquidation.collGasCompensation);

        // If ICR <= 100%, purely redistribute the Trove across all active Troves
        if (_ICR <= _100pct) {
            _movePendingTroveRewardsToActivePool(_activePool, _defaultPool, _collateral, vars.pendingDebtReward, vars.pendingCollReward);
            _removeStake(_borrower, _collateral);
           
            singleLiquidation.debtToOffset = 0;
            singleLiquidation.collToSendToSP = 0;
            singleLiquidation.debtToRedistribute = singleLiquidation.entireTroveDebt;
            singleLiquidation.collToRedistribute = vars.collToLiquidate;

            _closeTrove(_borrower, _collateral, Status.closedByLiquidation);
            emit TroveLiquidated(_borrower, _collateral, singleLiquidation.entireTroveDebt, singleLiquidation.entireTroveColl, TroveManagerOperation.liquidateInRecoveryMode);
            emit TroveUpdated(_borrower, _collateral, 0, 0, 0, TroveManagerOperation.liquidateInRecoveryMode);
            
        // If 100% < ICR < MCR, offset as much as possible, and redistribute the remainder
        } else if ((_ICR > _100pct) && (_ICR < _MCR)) {
             _movePendingTroveRewardsToActivePool(_activePool, _defaultPool, _collateral, vars.pendingDebtReward, vars.pendingCollReward);
            _removeStake(_borrower, _collateral);

            (singleLiquidation.debtToOffset,
            singleLiquidation.collToSendToSP,
            singleLiquidation.debtToRedistribute,
            singleLiquidation.collToRedistribute) = _getOffsetAndRedistributionVals(singleLiquidation.entireTroveDebt, vars.collToLiquidate, _LUSDInStabPool);

            _closeTrove(_borrower, _collateral, Status.closedByLiquidation);
            emit TroveLiquidated(_borrower, _collateral, singleLiquidation.entireTroveDebt, singleLiquidation.entireTroveColl, TroveManagerOperation.liquidateInRecoveryMode);
            emit TroveUpdated(_borrower, _collateral, 0, 0, 0, TroveManagerOperation.liquidateInRecoveryMode);
        /*
        * If MCR <= ICR < current TCR (accounting for the preceding liquidations in the current sequence)
        * and there is LUSD in the Stability Pool, only offset, with no redistribution,
        * but at a capped rate of MCR and only if the whole debt can be liquidated.
        * The remainder due to the capped rate will be claimable as collateral surplus.
        */
        } else if ((_ICR >= _MCR) && (_ICR < _TCR) && (singleLiquidation.entireTroveDebt <= _LUSDInStabPool)) {
            _movePendingTroveRewardsToActivePool(_activePool, _defaultPool, _collateral, vars.pendingDebtReward, vars.pendingCollReward);
            assert(_LUSDInStabPool != 0);

            _removeStake(_borrower, _collateral);
            uint collDecimals = collateralConfig.getCollateralDecimals(_collateral);
            singleLiquidation = _getCappedOffsetVals(singleLiquidation.entireTroveDebt, singleLiquidation.entireTroveColl, _price, _MCR, collDecimals);

            _closeTrove(_borrower, _collateral, Status.closedByLiquidation);
            if (singleLiquidation.collSurplus > 0) {
                collSurplusPool.accountSurplus(_borrower, _collateral, singleLiquidation.collSurplus);
            }

            emit TroveLiquidated(_borrower, _collateral, singleLiquidation.entireTroveDebt, singleLiquidation.collToSendToSP, TroveManagerOperation.liquidateInRecoveryMode);
            emit TroveUpdated(_borrower, _collateral, 0, 0, 0, TroveManagerOperation.liquidateInRecoveryMode);

        } else { // if (_ICR >= _MCR && ( _ICR >= _TCR || singleLiquidation.entireTroveDebt > _LUSDInStabPool))
            LiquidationValues memory zeroVals;
            return zeroVals;
        }

        return singleLiquidation;
    }

    /* In a full liquidation, returns the values for a trove's coll and debt to be offset, and coll and debt to be
    * redistributed to active troves.
    */
    function _getOffsetAndRedistributionVals
    (
        uint _debt,
        uint _coll,
        uint _LUSDInStabPool
    )
        internal
        pure
        returns (uint debtToOffset, uint collToSendToSP, uint debtToRedistribute, uint collToRedistribute)
    {
        if (_LUSDInStabPool > 0) {
        /*
        * Offset as much debt & collateral as possible against the Stability Pool, and redistribute the remainder
        * between all active troves.
        *
        *  If the trove's debt is larger than the deposited LUSD in the Stability Pool:
        *
        *  - Offset an amount of the trove's debt equal to the LUSD in the Stability Pool
        *  - Send a fraction of the trove's collateral to the Stability Pool, equal to the fraction of its offset debt
        *
        */
            debtToOffset = LiquityMath._min(_debt, _LUSDInStabPool);
            collToSendToSP = _coll.mul(debtToOffset).div(_debt);
            debtToRedistribute = _debt.sub(debtToOffset);
            collToRedistribute = _coll.sub(collToSendToSP);
        } else {
            debtToOffset = 0;
            collToSendToSP = 0;
            debtToRedistribute = _debt;
            collToRedistribute = _coll;
        }
    }

    /*
    *  Get its offset coll/debt and ETH gas comp, and close the trove.
    */
    function _getCappedOffsetVals
    (
        uint _entireTroveDebt,
        uint _entireTroveColl,
        uint _price,
        uint256 _MCR,
        uint _collDecimals
    )
        internal
        pure
        returns (LiquidationValues memory singleLiquidation)
    {
        singleLiquidation.entireTroveDebt = _entireTroveDebt;
        singleLiquidation.entireTroveColl = _entireTroveColl;
        uint cappedCollPortion = _entireTroveDebt.mul(_MCR).div(_price);
        if (_collDecimals < LiquityMath.CR_CALCULATION_DECIMALS) {
            cappedCollPortion = cappedCollPortion.div(10 ** (LiquityMath.CR_CALCULATION_DECIMALS - _collDecimals));
        } else if (_collDecimals > LiquityMath.CR_CALCULATION_DECIMALS) {
            cappedCollPortion = cappedCollPortion.mul(10 ** (_collDecimals - LiquityMath.CR_CALCULATION_DECIMALS));
        }

        singleLiquidation.collGasCompensation = _getCollGasCompensation(cappedCollPortion);
        singleLiquidation.LUSDGasCompensation = LUSD_GAS_COMPENSATION;

        singleLiquidation.debtToOffset = _entireTroveDebt;
        singleLiquidation.collToSendToSP = cappedCollPortion.sub(singleLiquidation.collGasCompensation);
        singleLiquidation.collSurplus = _entireTroveColl.sub(cappedCollPortion);
        singleLiquidation.debtToRedistribute = 0;
        singleLiquidation.collToRedistribute = 0;
    }

    /*
    * Liquidate a sequence of troves. Closes a maximum number of n under-collateralized Troves,
    * starting from the one with the lowest collateral ratio in the system, and moving upwards
    */
    function liquidateTroves(address _collateral, uint _n) external override {
        IActivePool activePoolCached = activePool;
        IDefaultPool defaultPoolCached = defaultPool;
        IStabilityPool stabilityPoolCached = stabilityPool;

        LocalVariables_OuterLiquidationFunction memory vars;
        LiquidationTotals memory totals;

        vars.collCCR = collateralConfig.getCollateralCCR(_collateral);
        vars.collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        vars.collMCR = collateralConfig.getCollateralMCR(_collateral);
        vars.price = priceFeed.fetchPrice(_collateral);
        vars.LUSDInStabPool = stabilityPoolCached.getTotalLUSDDeposits();
        vars.recoveryModeAtStart = _checkRecoveryMode(_collateral, vars.price, vars.collCCR, vars.collDecimals);

        // Perform the appropriate liquidation sequence - tally the values, and obtain their totals
        if (vars.recoveryModeAtStart) {
            totals = _getTotalsFromLiquidateTrovesSequence_RecoveryMode(
                activePoolCached,
                defaultPoolCached,
                sortedTroves,
                _collateral,
                vars.price,
                vars.LUSDInStabPool,
                _n
            );
        } else { // if !vars.recoveryModeAtStart
            totals = _getTotalsFromLiquidateTrovesSequence_NormalMode(
                activePoolCached,
                defaultPoolCached,
                _collateral,
                vars.price,
                vars.collMCR,
                vars.LUSDInStabPool,
                _n
            );
        }

        require(totals.totalDebtInSequence > 0);

        // Move liquidated collateral and LUSD to the appropriate pools
        stabilityPoolCached.offset(_collateral, totals.totalDebtToOffset, totals.totalCollToSendToSP);
        _redistributeDebtAndColl(
            activePoolCached,
            defaultPoolCached,
            _collateral,
            totals.totalDebtToRedistribute,
            totals.totalCollToRedistribute,
            vars.collDecimals
        );
        if (totals.totalCollSurplus > 0) {
            activePoolCached.sendCollateral(_collateral, address(collSurplusPool), totals.totalCollSurplus);
        }

        // Update system snapshots
        _updateSystemSnapshots_excludeCollRemainder(activePoolCached, _collateral, totals.totalCollGasCompensation);

        vars.liquidatedDebt = totals.totalDebtInSequence;
        vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(totals.totalCollSurplus);
        emit Liquidation(_collateral, vars.liquidatedDebt, vars.liquidatedColl, totals.totalCollGasCompensation, totals.totalLUSDGasCompensation);

        // Send gas compensation to caller
        _sendGasCompensation(activePoolCached, _collateral, msg.sender, totals.totalLUSDGasCompensation, totals.totalCollGasCompensation);
    }

    /*
    * This function is used when the liquidateTroves sequence starts during Recovery Mode. However, it
    * handle the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
    */
    function _getTotalsFromLiquidateTrovesSequence_RecoveryMode
    (
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        ISortedTroves _sortedTroves,
        address _collateral,
        uint _price,
        uint _LUSDInStabPool,
        uint _n
    )
        internal
        returns(LiquidationTotals memory totals)
    {
        LocalVariables_LiquidationSequence memory vars;
        vars.collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        vars.collCCR = collateralConfig.getCollateralCCR(_collateral);
        vars.collMCR = collateralConfig.getCollateralMCR(_collateral);
        LiquidationValues memory singleLiquidation;

        vars.remainingLUSDInStabPool = _LUSDInStabPool;
        vars.backToNormalMode = false;
        vars.entireSystemDebt = getEntireSystemDebt(_collateral);
        vars.entireSystemColl = getEntireSystemColl(_collateral);

        vars.user = _sortedTroves.getLast(_collateral);
        address firstUser = _sortedTroves.getFirst(_collateral);
        for (vars.i = 0; vars.i < _n && vars.user != firstUser; vars.i++) {
            // we need to cache it, because current user is likely going to be deleted
            address nextUser = _sortedTroves.getPrev(_collateral, vars.user);

            vars.ICR = getCurrentICR(vars.user, _collateral, _price);

            if (!vars.backToNormalMode) {
                // Break the loop if ICR is greater than MCR and Stability Pool is empty
                if (vars.ICR >= vars.collMCR && vars.remainingLUSDInStabPool == 0) { break; }

                vars.TCR = LiquityMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, _price, vars.collDecimals);

                singleLiquidation = _liquidateRecoveryMode(
                    _activePool,
                    _defaultPool,
                    _collateral,
                    vars.user,
                    vars.ICR,
                    vars.remainingLUSDInStabPool,
                    vars.TCR,
                    _price,
                    vars.collMCR
                );

                // Update aggregate trackers
                vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);
                vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
                vars.entireSystemColl = vars.entireSystemColl.
                    sub(singleLiquidation.collToSendToSP).
                    sub(singleLiquidation.collGasCompensation).
                    sub(singleLiquidation.collSurplus);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

                vars.backToNormalMode = !_checkPotentialRecoveryMode(
                    vars.entireSystemColl,
                    vars.entireSystemDebt,
                    _price,
                    vars.collDecimals,
                    vars.collCCR
                );
            }
            else if (vars.backToNormalMode && vars.ICR < vars.collMCR) {
                singleLiquidation = _liquidateNormalMode(
                    _activePool,
                    _defaultPool,
                    _collateral,
                    vars.user,
                    vars.remainingLUSDInStabPool
                );

                vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

            }  else break;  // break if the loop reaches a Trove with ICR >= MCR

            vars.user = nextUser;
        }
    }

    function _getTotalsFromLiquidateTrovesSequence_NormalMode
    (
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _collateral,
        uint _price,
        uint256 _MCR,
        uint _LUSDInStabPool,
        uint _n
    )
        internal
        returns(LiquidationTotals memory totals)
    {
        LocalVariables_LiquidationSequence memory vars;
        LiquidationValues memory singleLiquidation;
        ISortedTroves sortedTrovesCached = sortedTroves;

        vars.remainingLUSDInStabPool = _LUSDInStabPool;

        for (vars.i = 0; vars.i < _n; vars.i++) {
            vars.user = sortedTrovesCached.getLast(_collateral);
            vars.ICR = getCurrentICR(vars.user, _collateral, _price);

            if (vars.ICR < _MCR) {
                singleLiquidation = _liquidateNormalMode(
                    _activePool,
                    _defaultPool,
                    _collateral,
                    vars.user,
                    vars.remainingLUSDInStabPool
                );

                vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

            } else break;  // break if the loop reaches a Trove with ICR >= MCR
        }
    }

    /*
    * Attempt to liquidate a custom list of troves (for the specified collateral) provided by the caller.
    */
    function batchLiquidateTroves(address _collateral, address[] memory _troveArray) public override {
        require(_troveArray.length != 0);

        IActivePool activePoolCached = activePool;
        IDefaultPool defaultPoolCached = defaultPool;
        IStabilityPool stabilityPoolCached = stabilityPool;

        LocalVariables_OuterLiquidationFunction memory vars;
        LiquidationTotals memory totals;

        vars.collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        vars.collCCR = collateralConfig.getCollateralCCR(_collateral);
        vars.collMCR = collateralConfig.getCollateralMCR(_collateral);
        vars.price = priceFeed.fetchPrice(_collateral);
        vars.LUSDInStabPool = stabilityPoolCached.getTotalLUSDDeposits();
        vars.recoveryModeAtStart = _checkRecoveryMode(_collateral, vars.price, vars.collCCR, vars.collDecimals);

        // Perform the appropriate liquidation sequence - tally values and obtain their totals.
        if (vars.recoveryModeAtStart) {
            totals = _getTotalFromBatchLiquidate_RecoveryMode(
                activePoolCached,
                defaultPoolCached,
                _collateral,
                vars.price,
                vars.LUSDInStabPool,
                _troveArray
            );
        } else {  //  if !vars.recoveryModeAtStart
            totals = _getTotalsFromBatchLiquidate_NormalMode(
                activePoolCached,
                defaultPoolCached,
                _collateral,
                vars.price,
                vars.collMCR,
                vars.LUSDInStabPool,
                _troveArray
            );
        }

        require(totals.totalDebtInSequence > 0);

        // Move liquidated collateral and LUSD to the appropriate pools
        stabilityPoolCached.offset(_collateral, totals.totalDebtToOffset, totals.totalCollToSendToSP);
        _redistributeDebtAndColl(
            activePoolCached,
            defaultPoolCached,
            _collateral,
            totals.totalDebtToRedistribute,
            totals.totalCollToRedistribute,
            vars.collDecimals
        );
        if (totals.totalCollSurplus > 0) {
            activePoolCached.sendCollateral(_collateral, address(collSurplusPool), totals.totalCollSurplus);
        }

        // Update system snapshots
        _updateSystemSnapshots_excludeCollRemainder(activePoolCached, _collateral, totals.totalCollGasCompensation);

        vars.liquidatedDebt = totals.totalDebtInSequence;
        vars.liquidatedColl = totals.totalCollInSequence.sub(totals.totalCollGasCompensation).sub(totals.totalCollSurplus);
        emit Liquidation(_collateral, vars.liquidatedDebt, vars.liquidatedColl, totals.totalCollGasCompensation, totals.totalLUSDGasCompensation);

        // Send gas compensation to caller
        _sendGasCompensation(activePoolCached, _collateral, msg.sender, totals.totalLUSDGasCompensation, totals.totalCollGasCompensation);
    }

    /*
    * This function is used when the batch liquidation sequence starts during Recovery Mode. However, it
    * handle the case where the system *leaves* Recovery Mode, part way through the liquidation sequence
    */
    function _getTotalFromBatchLiquidate_RecoveryMode
    (
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _collateral,
        uint _price,
        uint _LUSDInStabPool,
        address[] memory _troveArray
    )
        internal
        returns(LiquidationTotals memory totals)
    {
        LocalVariables_LiquidationSequence memory vars;
        vars.collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        vars.collCCR = collateralConfig.getCollateralCCR(_collateral);
        vars.collMCR = collateralConfig.getCollateralMCR(_collateral);
        LiquidationValues memory singleLiquidation;

        vars.remainingLUSDInStabPool = _LUSDInStabPool;
        vars.backToNormalMode = false;
        vars.entireSystemDebt = getEntireSystemDebt(_collateral);
        vars.entireSystemColl = getEntireSystemColl(_collateral);

        for (vars.i = 0; vars.i < _troveArray.length; vars.i++) {
            vars.user = _troveArray[vars.i];
            // Skip non-active troves
            if (Troves[vars.user][_collateral].status != Status.active) { continue; }
            vars.ICR = getCurrentICR(vars.user, _collateral, _price);

            if (!vars.backToNormalMode) {

                // Skip this trove if ICR is greater than MCR and Stability Pool is empty
                if (vars.ICR >= vars.collMCR && vars.remainingLUSDInStabPool == 0) { continue; }

                uint TCR = LiquityMath._computeCR(vars.entireSystemColl, vars.entireSystemDebt, _price, vars.collDecimals);

                singleLiquidation = _liquidateRecoveryMode(
                    _activePool,
                    _defaultPool,
                    _collateral,
                    vars.user,
                    vars.ICR,
                    vars.remainingLUSDInStabPool,
                    TCR,
                    _price,
                    vars.collMCR
                );

                // Update aggregate trackers
                vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);
                vars.entireSystemDebt = vars.entireSystemDebt.sub(singleLiquidation.debtToOffset);
                vars.entireSystemColl = vars.entireSystemColl.
                    sub(singleLiquidation.collToSendToSP).
                    sub(singleLiquidation.collGasCompensation).
                    sub(singleLiquidation.collSurplus);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

                vars.backToNormalMode = !_checkPotentialRecoveryMode(
                    vars.entireSystemColl,
                    vars.entireSystemDebt,
                    _price,
                    vars.collDecimals,
                    vars.collCCR
                );
            }

            else if (vars.backToNormalMode && vars.ICR < vars.collMCR) {
                singleLiquidation = _liquidateNormalMode(_activePool, _defaultPool, _collateral, vars.user, vars.remainingLUSDInStabPool);
                vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);

            } else continue; // In Normal Mode skip troves with ICR >= MCR
        }
    }

    function _getTotalsFromBatchLiquidate_NormalMode
    (
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _collateral,
        uint _price,
        uint256 _MCR,
        uint _LUSDInStabPool,
        address[] memory _troveArray
    )
        internal
        returns(LiquidationTotals memory totals)
    {
        LocalVariables_LiquidationSequence memory vars;
        LiquidationValues memory singleLiquidation;

        vars.remainingLUSDInStabPool = _LUSDInStabPool;

        for (vars.i = 0; vars.i < _troveArray.length; vars.i++) {
            vars.user = _troveArray[vars.i];
            vars.ICR = getCurrentICR(vars.user, _collateral, _price);

            if (vars.ICR < _MCR) {
                singleLiquidation = _liquidateNormalMode(_activePool, _defaultPool, _collateral, vars.user, vars.remainingLUSDInStabPool);
                vars.remainingLUSDInStabPool = vars.remainingLUSDInStabPool.sub(singleLiquidation.debtToOffset);

                // Add liquidation values to their respective running totals
                totals = _addLiquidationValuesToTotals(totals, singleLiquidation);
            }
        }
    }

    // --- Liquidation helper functions ---

    function _addLiquidationValuesToTotals(LiquidationTotals memory oldTotals, LiquidationValues memory singleLiquidation)
    internal pure returns(LiquidationTotals memory newTotals) {

        // Tally all the values with their respective running totals
        newTotals.totalCollGasCompensation = oldTotals.totalCollGasCompensation.add(singleLiquidation.collGasCompensation);
        newTotals.totalLUSDGasCompensation = oldTotals.totalLUSDGasCompensation.add(singleLiquidation.LUSDGasCompensation);
        newTotals.totalDebtInSequence = oldTotals.totalDebtInSequence.add(singleLiquidation.entireTroveDebt);
        newTotals.totalCollInSequence = oldTotals.totalCollInSequence.add(singleLiquidation.entireTroveColl);
        newTotals.totalDebtToOffset = oldTotals.totalDebtToOffset.add(singleLiquidation.debtToOffset);
        newTotals.totalCollToSendToSP = oldTotals.totalCollToSendToSP.add(singleLiquidation.collToSendToSP);
        newTotals.totalDebtToRedistribute = oldTotals.totalDebtToRedistribute.add(singleLiquidation.debtToRedistribute);
        newTotals.totalCollToRedistribute = oldTotals.totalCollToRedistribute.add(singleLiquidation.collToRedistribute);
        newTotals.totalCollSurplus = oldTotals.totalCollSurplus.add(singleLiquidation.collSurplus);

        return newTotals;
    }

    function _sendGasCompensation(IActivePool _activePool, address _collateral, address _liquidator, uint _LUSD, uint _collAmount) internal {
        if (_LUSD > 0) {
            lusdToken.returnFromPool(gasPoolAddress, _liquidator, _LUSD);
        }

        if (_collAmount > 0) {
            _activePool.sendCollateral(_collateral, _liquidator, _collAmount);
        }
    }

    // Move a Trove's pending debt and collateral rewards from distributions, from the Default Pool to the Active Pool
    function _movePendingTroveRewardsToActivePool(IActivePool _activePool, IDefaultPool _defaultPool, address _collateral, uint _LUSD, uint _collAmount) internal {
        _defaultPool.decreaseLUSDDebt(_collateral, _LUSD);
        _activePool.increaseLUSDDebt(_collateral, _LUSD);
        _defaultPool.sendCollateralToActivePool(_collateral, _collAmount);
    }

    /*
    * Called when a full redemption occurs, and closes the trove.
    * The redeemer swaps (debt - liquidation reserve) LUSD for (debt - liquidation reserve) worth of collateral, so the LUSD liquidation reserve left corresponds to the remaining debt.
    * In order to close the trove, the LUSD liquidation reserve is burned, and the corresponding debt is removed from the active pool.
    * The debt recorded on the trove's struct is zero'd elswhere, in _closeTrove.
    * Any surplus collateral left in the trove, is sent to the Coll surplus pool, and can be later claimed by the borrower.
    */
    function redeemCloseTrove(
        address _borrower,
        address _collateral,
        uint256 _LUSD,
        uint256 _collAmount
    ) external override {
        _requireCallerIsRedemptionHelper();
        lusdToken.burn(gasPoolAddress, _LUSD);
        // Update Active Pool LUSD, and send ETH to account
        activePool.decreaseLUSDDebt(_collateral, _LUSD);

        // send ETH from Active Pool to CollSurplus Pool
        collSurplusPool.accountSurplus(_borrower, _collateral, _collAmount);
        activePool.sendCollateral(_collateral, address(collSurplusPool), _collAmount);

        emit TroveUpdated(_borrower, _collateral, 0, 0, 0, TroveManagerOperation.redeemCollateral);
    }

    function reInsert(address _id, address _collateral, uint256 _newNICR, address _prevId, address _nextId) external override {
        _requireCallerIsRedemptionHelper();
        sortedTroves.reInsert(_id, _collateral, _newNICR, _prevId, _nextId);
    }

    function updateDebtAndCollAndStakesPostRedemption(
        address _borrower,
        address _collateral,
        uint256 _newDebt,
        uint256 _newColl
    ) external override {
        _requireCallerIsRedemptionHelper();
        Troves[_borrower][_collateral].debt = _newDebt;
        Troves[_borrower][_collateral].coll = _newColl;
        _updateStakeAndTotalStakes(_borrower, _collateral);

        emit TroveUpdated(
            _borrower,
            _collateral,
            _newDebt, _newColl,
            Troves[_borrower][_collateral].stake,
            TroveManagerOperation.redeemCollateral
        );
    }

    function burnLUSDAndEmitRedemptionEvent(
        address _redeemer,
        address _collateral,
        uint _attemptedLUSDAmount,
        uint _actualLUSDAmount,
        uint _collSent,
        uint _collFee
    ) external override {
        _requireCallerIsRedemptionHelper();
        lusdToken.burn(_redeemer, _actualLUSDAmount);
        emit Redemption(_collateral, _attemptedLUSDAmount, _actualLUSDAmount, _collSent, _collFee);
    }

    /* Send _LUSDamount LUSD to the system and redeem the corresponding amount of collateral from as many Troves as are needed to fill the redemption
    * request.  Applies pending rewards to a Trove before reducing its debt and coll.
    *
    * Note that if _amount is very large, this function can run out of gas, specially if traversed troves are small. This can be easily avoided by
    * splitting the total _amount in appropriate chunks and calling the function multiple times.
    *
    * Param `_maxIterations` can also be provided, so the loop through Troves is capped (if it’s zero, it will be ignored).This makes it easier to
    * avoid OOG for the frontend, as only knowing approximately the average cost of an iteration is enough, without needing to know the “topology”
    * of the trove list. It also avoids the need to set the cap in stone in the contract, nor doing gas calculations, as both gas price and opcode
    * costs can vary.
    *
    * All Troves that are redeemed from -- with the likely exception of the last one -- will end up with no debt left, therefore they will be closed.
    * If the last Trove does have some remaining debt, it has a finite ICR, and the reinsertion could be anywhere in the list, therefore it requires a hint.
    * A frontend should use getRedemptionHints() to calculate what the ICR of this Trove will be after redemption, and pass a hint for its position
    * in the sortedTroves list along with the ICR value that the hint was found for.
    *
    * If another transaction modifies the list between calling getRedemptionHints() and passing the hints to redeemCollateral(), it
    * is very likely that the last (partially) redeemed Trove would end up with a different ICR than what the hint is for. In this case the
    * redemption will stop after the last completely redeemed Trove and the sender will keep the remaining LUSD amount, which they can attempt
    * to redeem later.
    */
    function redeemCollateral(
        address _collateral,
        uint _LUSDamount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR,
        uint _maxIterations,
        uint _maxFeePercentage
    )
        external
        override
    {
        redemptionHelper.redeemCollateral(
            _collateral,
            msg.sender,
            _LUSDamount,
            _firstRedemptionHint,
            _upperPartialRedemptionHint,
            _lowerPartialRedemptionHint,
            _partialRedemptionHintNICR,
            _maxIterations,
            _maxFeePercentage
        );
    }

    // --- Helper functions ---

    // Return the nominal collateral ratio (ICR) of a given Trove, without the price. Takes a trove's pending coll and debt rewards from redistributions into account.
    function getNominalICR(address _borrower, address _collateral) public view override returns (uint) {
        (uint currentCollateral, uint currentLUSDDebt) = _getCurrentTroveAmounts(_borrower, _collateral);

        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        uint NICR = LiquityMath._computeNominalCR(currentCollateral, currentLUSDDebt, collDecimals);
        return NICR;
    }

    // Return the current collateral ratio (ICR) of a given Trove. Takes a trove's pending coll and debt rewards from redistributions into account.
    function getCurrentICR(
        address _borrower,
        address _collateral,
        uint _price
    ) public view override returns (uint) {
        (uint currentCollateral, uint currentLUSDDebt) = _getCurrentTroveAmounts(_borrower, _collateral);

        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        uint ICR = LiquityMath._computeCR(currentCollateral, currentLUSDDebt, _price, collDecimals);
        return ICR;
    }

    function _getCurrentTroveAmounts(address _borrower, address _collateral) internal view returns (uint, uint) {
        uint pendingCollateralReward = getPendingCollateralReward(_borrower, _collateral);
        uint pendingLUSDDebtReward = getPendingLUSDDebtReward(_borrower, _collateral);

        uint currentCollateral = Troves[_borrower][_collateral].coll.add(pendingCollateralReward);
        uint currentLUSDDebt = Troves[_borrower][_collateral].debt.add(pendingLUSDDebtReward);

        return (currentCollateral, currentLUSDDebt);
    }

    function applyPendingRewards(address _borrower, address _collateral) external override {
        _requireCallerIsBorrowerOperationsOrRedemptionHelper();
        return _applyPendingRewards(activePool, defaultPool, _borrower, _collateral);
    }

    // Add the borrowers's coll and debt rewards earned from redistributions, to their Trove
    function _applyPendingRewards(IActivePool _activePool, IDefaultPool _defaultPool, address _borrower, address _collateral) internal {
        if (hasPendingRewards(_borrower, _collateral)) {
            _requireTroveIsActive(_borrower, _collateral);

            // Compute pending rewards
            uint pendingCollateralReward = getPendingCollateralReward(_borrower, _collateral);
            uint pendingLUSDDebtReward = getPendingLUSDDebtReward(_borrower, _collateral);

            // Apply pending rewards to trove's state
            Troves[_borrower][_collateral].coll = Troves[_borrower][_collateral].coll.add(pendingCollateralReward);
            Troves[_borrower][_collateral].debt = Troves[_borrower][_collateral].debt.add(pendingLUSDDebtReward);

            _updateTroveRewardSnapshots(_borrower, _collateral);

            // Transfer from DefaultPool to ActivePool
            _movePendingTroveRewardsToActivePool(_activePool, _defaultPool, _collateral, pendingLUSDDebtReward, pendingCollateralReward);

            emit TroveUpdated(
                _borrower,
                _collateral,
                Troves[_borrower][_collateral].debt,
                Troves[_borrower][_collateral].coll,
                Troves[_borrower][_collateral].stake,
                TroveManagerOperation.applyPendingRewards
            );
        }
    }

    // Update borrower's snapshots of L_Collateral and L_LUSDDebt to reflect the current values
    function updateTroveRewardSnapshots(address _borrower, address _collateral) external override {
        _requireCallerIsBorrowerOperations();
       return _updateTroveRewardSnapshots(_borrower, _collateral);
    }

    function _updateTroveRewardSnapshots(address _borrower, address _collateral) internal {
        rewardSnapshots[_borrower][_collateral].collAmount = L_Collateral[_collateral];
        rewardSnapshots[_borrower][_collateral].LUSDDebt = L_LUSDDebt[_collateral];
        emit TroveSnapshotsUpdated(_collateral, L_Collateral[_collateral], L_LUSDDebt[_collateral]);
    }

    // Get the borrower's pending accumulated collateral reward, earned by their stake
    function getPendingCollateralReward(address _borrower, address _collateral) public view override returns (uint) {
        uint snapshotCollateral = rewardSnapshots[_borrower][_collateral].collAmount;
        uint rewardPerUnitStaked = L_Collateral[_collateral].sub(snapshotCollateral);

        if ( rewardPerUnitStaked == 0 || Troves[_borrower][_collateral].status != Status.active) { return 0; }

        uint stake = Troves[_borrower][_collateral].stake;

        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        uint pendingCollateralReward = stake.mul(rewardPerUnitStaked).div(10**collDecimals);

        return pendingCollateralReward;
    }
    
    // Get the borrower's pending accumulated LUSD reward, earned by their stake
    function getPendingLUSDDebtReward(address _borrower, address _collateral) public view override returns (uint) {
        uint snapshotLUSDDebt = rewardSnapshots[_borrower][_collateral].LUSDDebt;
        uint rewardPerUnitStaked = L_LUSDDebt[_collateral].sub(snapshotLUSDDebt);

        if ( rewardPerUnitStaked == 0 || Troves[_borrower][_collateral].status != Status.active) { return 0; }

        uint stake = Troves[_borrower][_collateral].stake;

        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        uint pendingLUSDDebtReward = stake.mul(rewardPerUnitStaked).div(10**collDecimals);

        return pendingLUSDDebtReward;
    }

    function hasPendingRewards(address _borrower, address _collateral) public view override returns (bool) {
        /*
        * A Trove has pending rewards if its snapshot is less than the current rewards per-unit-staked sum:
        * this indicates that rewards have occured since the snapshot was made, and the user therefore has
        * pending rewards
        */
        if (Troves[_borrower][_collateral].status != Status.active) {return false;}
       
        return (rewardSnapshots[_borrower][_collateral].collAmount < L_Collateral[_collateral]);
    }

    // Return the Troves entire debt and coll, including pending rewards from redistributions.
    function getEntireDebtAndColl(
        address _borrower,
        address _collateral
    )
        public
        view
        override
        returns (uint debt, uint coll, uint pendingLUSDDebtReward, uint pendingCollateralReward)
    {
        debt = Troves[_borrower][_collateral].debt;
        coll = Troves[_borrower][_collateral].coll;

        pendingLUSDDebtReward = getPendingLUSDDebtReward(_borrower, _collateral);
        pendingCollateralReward = getPendingCollateralReward(_borrower, _collateral);

        debt = debt.add(pendingLUSDDebtReward);
        coll = coll.add(pendingCollateralReward);
    }

    function removeStake(address _borrower, address _collateral) external override {
        _requireCallerIsBorrowerOperationsOrRedemptionHelper();
        return _removeStake(_borrower, _collateral);
    }

    // Remove borrower's stake from the totalStakes sum, and set their stake to 0
    function _removeStake(address _borrower, address _collateral) internal {
        uint stake = Troves[_borrower][_collateral].stake;
        totalStakes[_collateral] = totalStakes[_collateral].sub(stake);
        Troves[_borrower][_collateral].stake = 0;
    }

    function updateStakeAndTotalStakes(address _borrower, address _collateral) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        return _updateStakeAndTotalStakes(_borrower, _collateral);
    }

    // Update borrower's stake based on their latest collateral value
    function _updateStakeAndTotalStakes(address _borrower, address _collateral) internal returns (uint) {
        uint newStake = _computeNewStake(_collateral, Troves[_borrower][_collateral].coll);
        uint oldStake = Troves[_borrower][_collateral].stake;
        Troves[_borrower][_collateral].stake = newStake;

        totalStakes[_collateral] = totalStakes[_collateral].sub(oldStake).add(newStake);
        emit TotalStakesUpdated(_collateral, totalStakes[_collateral]);

        return newStake;
    }

    // Calculate a new stake based on the snapshots of the totalStakes and totalCollateral taken at the last liquidation
    function _computeNewStake(address _collateral, uint _coll) internal view returns (uint) {
        uint stake;
        if (totalCollateralSnapshot[_collateral] == 0) {
            stake = _coll;
        } else {
            /*
            * The following assert() holds true because:
            * - The system always contains >= 1 trove
            * - When we close or liquidate a trove, we redistribute the pending rewards, so if all troves were closed/liquidated,
            * rewards would’ve been emptied and totalCollateralSnapshot would be zero too.
            */
            assert(totalStakesSnapshot[_collateral] > 0);
            stake = _coll.mul(totalStakesSnapshot[_collateral]).div(totalCollateralSnapshot[_collateral]);
        }
        return stake;
    }

    function _redistributeDebtAndColl(
        IActivePool _activePool,
        IDefaultPool _defaultPool,
        address _collateral,
        uint _debt,
        uint _coll,
        uint256 _collDecimals
    ) internal {
        if (_debt == 0) { return; }

        /*
        * Add distributed coll and debt rewards-per-unit-staked to the running totals. Division uses a "feedback"
        * error correction, to keep the cumulative error low in the running totals L_Collateral and L_LUSDDebt:
        *
        * 1) Form numerators which compensate for the floor division errors that occurred the last time this
        * function was called.
        * 2) Calculate "per-unit-staked" ratios.
        * 3) Multiply each ratio back by its denominator, to reveal the current floor division error.
        * 4) Store these errors for use in the next correction when this function is called.
        * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
        */
        uint collateralNumerator = _coll.mul(10**_collDecimals).add(lastCollateralError_Redistribution[_collateral]);
        uint LUSDDebtNumerator = _debt.mul(10**_collDecimals).add(lastLUSDDebtError_Redistribution[_collateral]);

        // Get the per-unit-staked terms
        uint collateralRewardPerUnitStaked = collateralNumerator.div(totalStakes[_collateral]);
        uint LUSDDebtRewardPerUnitStaked = LUSDDebtNumerator.div(totalStakes[_collateral]);

        lastCollateralError_Redistribution[_collateral] = collateralNumerator.sub(collateralRewardPerUnitStaked.mul(totalStakes[_collateral]));
        lastLUSDDebtError_Redistribution[_collateral] = LUSDDebtNumerator.sub(LUSDDebtRewardPerUnitStaked.mul(totalStakes[_collateral]));

        // Add per-unit-staked terms to the running totals
        L_Collateral[_collateral] = L_Collateral[_collateral].add(collateralRewardPerUnitStaked);
        L_LUSDDebt[_collateral] = L_LUSDDebt[_collateral].add(LUSDDebtRewardPerUnitStaked);

        emit LTermsUpdated(_collateral, L_Collateral[_collateral], L_LUSDDebt[_collateral]);

        // Transfer coll and debt from ActivePool to DefaultPool
        _activePool.decreaseLUSDDebt(_collateral, _debt);
        _defaultPool.increaseLUSDDebt(_collateral, _debt);
        _activePool.sendCollateral(_collateral, address(_defaultPool), _coll);
    }

    function closeTrove(address _borrower, address _collateral, uint256 _closedStatusNum) external override {
        _requireCallerIsBorrowerOperationsOrRedemptionHelper();
        return _closeTrove(_borrower, _collateral, Status(_closedStatusNum));
    }

    function _closeTrove(address _borrower, address _collateral, Status closedStatus) internal {
        assert(closedStatus != Status.nonExistent && closedStatus != Status.active);

        uint TroveOwnersArrayLength = TroveOwners[_collateral].length;
        _requireMoreThanOneTroveInSystem(TroveOwnersArrayLength, _collateral);

        Troves[_borrower][_collateral].status = closedStatus;
        Troves[_borrower][_collateral].coll = 0;
        Troves[_borrower][_collateral].debt = 0;

        rewardSnapshots[_borrower][_collateral].collAmount = 0;
        rewardSnapshots[_borrower][_collateral].LUSDDebt = 0;

        _removeTroveOwner(_borrower, _collateral, TroveOwnersArrayLength);
        sortedTroves.remove(_collateral, _borrower);
    }

    /*
    * Updates snapshots of system total stakes and total collateral, excluding a given collateral remainder from the calculation.
    * Used in a liquidation sequence.
    *
    * The calculation excludes a portion of collateral that is in the ActivePool:
    *
    * the total collateral gas compensation from the liquidation sequence
    *
    * The collateral as compensation must be excluded as it is always sent out at the very end of the liquidation sequence.
    */
    function _updateSystemSnapshots_excludeCollRemainder(IActivePool _activePool, address _collateral, uint _collRemainder) internal {
        totalStakesSnapshot[_collateral] = totalStakes[_collateral];

        uint activeColl = _activePool.getCollateral(_collateral);
        uint liquidatedColl = defaultPool.getCollateral(_collateral);
        totalCollateralSnapshot[_collateral] = activeColl.sub(_collRemainder).add(liquidatedColl);

        emit SystemSnapshotsUpdated(_collateral, totalStakesSnapshot[_collateral], totalCollateralSnapshot[_collateral]);
    }

    // Push the owner's address to the Trove owners list, and record the corresponding array index on the Trove struct
    function addTroveOwnerToArray(address _borrower, address _collateral) external override returns (uint index) {
        _requireCallerIsBorrowerOperations();
        return _addTroveOwnerToArray(_borrower, _collateral);
    }

    function _addTroveOwnerToArray(address _borrower, address _collateral) internal returns (uint128 index) {
        /* Max array size is 2**128 - 1, i.e. ~3e30 troves. No risk of overflow, since troves have minimum LUSD
        debt of liquidation reserve plus MIN_NET_DEBT. 3e30 LUSD dwarfs the value of all wealth in the world ( which is < 1e15 USD). */

        // Push the Troveowner to the array
        TroveOwners[_collateral].push(_borrower);

        // Record the index of the new Troveowner on their Trove struct
        index = uint128(TroveOwners[_collateral].length.sub(1));
        Troves[_borrower][_collateral].arrayIndex = index;

        return index;
    }

    /*
    * Remove a Trove owner from the TroveOwners array, not preserving array order. Removing owner 'B' does the following:
    * [A B C D E] => [A E C D], and updates E's Trove struct to point to its new array index.
    */
    function _removeTroveOwner(address _borrower, address _collateral, uint TroveOwnersArrayLength) internal {
        Status troveStatus = Troves[_borrower][_collateral].status;
        // It’s set in caller function `_closeTrove`
        assert(troveStatus != Status.nonExistent && troveStatus != Status.active);

        uint128 index = Troves[_borrower][_collateral].arrayIndex;
        uint length = TroveOwnersArrayLength;
        uint idxLast = length.sub(1);

        assert(index <= idxLast);

        address addressToMove = TroveOwners[_collateral][idxLast];

        TroveOwners[_collateral][index] = addressToMove;
        Troves[addressToMove][_collateral].arrayIndex = index;
        emit TroveIndexUpdated(addressToMove, _collateral, index);

        TroveOwners[_collateral].pop();
    }

    // --- Recovery Mode and TCR functions ---

    function getTCR(address _collateral, uint _price) external view override returns (uint) {
        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        return _getTCR(_collateral, _price, collDecimals);
    }

    function checkRecoveryMode(address _collateral, uint _price) external view override returns (bool) {
        uint256 collCCR = collateralConfig.getCollateralCCR(_collateral);
        uint256 collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        return _checkRecoveryMode(_collateral, _price, collCCR, collDecimals);
    }

    // Check whether or not the system *would be* in Recovery Mode, given an ETH:USD price, and the entire system coll and debt.
    function _checkPotentialRecoveryMode(
        uint _entireSystemColl,
        uint _entireSystemDebt,
        uint _price,
        uint256 _collDecimals,
        uint256 _CCR
    )
        internal
        pure
    returns (bool)
    {
        uint TCR = LiquityMath._computeCR(_entireSystemColl, _entireSystemDebt, _price, _collDecimals);

        return TCR < _CCR;
    }

    // --- Redemption fee functions ---

    /*
    * This function has two impacts on the baseRate state variable:
    * 1) decays the baseRate based on time passed since last redemption or LUSD borrowing operation.
    * then,
    * 2) increases the baseRate based on the amount redeemed, as a proportion of total supply
    */
    function updateBaseRateFromRedemption(
        uint _collateralDrawn,
        uint _price,
        uint256 _collDecimals,
        uint _totalLUSDSupply
    ) external override returns (uint) {
        _requireCallerIsRedemptionHelper();
        uint decayedBaseRate = _calcDecayedBaseRate();

        /* Convert the drawn collateral back to LUSD at face value rate (1 LUSD:1 USD), in order to get
        * the fraction of total supply that was redeemed at face value. */
        uint redeemedLUSDFraction = 
            LiquityMath._getScaledCollAmount(_collateralDrawn, _collDecimals).mul(_price).div(_totalLUSDSupply);

        uint newBaseRate = decayedBaseRate.add(redeemedLUSDFraction.div(BETA));
        newBaseRate = LiquityMath._min(newBaseRate, DECIMAL_PRECISION); // cap baseRate at a maximum of 100%
        //assert(newBaseRate <= DECIMAL_PRECISION); // This is already enforced in the line above
        assert(newBaseRate > 0); // Base rate is always non-zero after redemption

        // Update the baseRate state variable
        baseRate = newBaseRate;
        emit BaseRateUpdated(newBaseRate);
        
        _updateLastFeeOpTime();

        return newBaseRate;
    }

    function getRedemptionRate() public view override returns (uint) {
        return _calcRedemptionRate(baseRate);
    }

    function getRedemptionRateWithDecay() public view override returns (uint) {
        return _calcRedemptionRate(_calcDecayedBaseRate());
    }

    function _calcRedemptionRate(uint _baseRate) internal pure returns (uint) {
        return LiquityMath._min(
            REDEMPTION_FEE_FLOOR.add(_baseRate),
            DECIMAL_PRECISION // cap at a maximum of 100%
        );
    }

    function getRedemptionFee(uint _collateralDrawn) public view override returns (uint) {
        return _calcRedemptionFee(getRedemptionRate(), _collateralDrawn);
    }

    function getRedemptionFeeWithDecay(uint _collateralDrawn) external view override returns (uint) {
        return _calcRedemptionFee(getRedemptionRateWithDecay(), _collateralDrawn);
    }

    function _calcRedemptionFee(uint _redemptionRate, uint _collateralDrawn) internal pure returns (uint) {
        uint redemptionFee = _redemptionRate.mul(_collateralDrawn).div(DECIMAL_PRECISION);
        require(redemptionFee < _collateralDrawn);
        return redemptionFee;
    }

    // --- Borrowing fee functions ---

    function getBorrowingRate() public view override returns (uint) {
        return _calcBorrowingRate(baseRate);
    }

    function getBorrowingRateWithDecay() public view override returns (uint) {
        return _calcBorrowingRate(_calcDecayedBaseRate());
    }

    function _calcBorrowingRate(uint _baseRate) internal pure returns (uint) {
        return LiquityMath._min(
            BORROWING_FEE_FLOOR.add(_baseRate),
            MAX_BORROWING_FEE
        );
    }

    function getBorrowingFee(uint _LUSDDebt) external view override returns (uint) {
        return _calcBorrowingFee(getBorrowingRate(), _LUSDDebt);
    }

    function getBorrowingFeeWithDecay(uint _LUSDDebt) external view override returns (uint) {
        return _calcBorrowingFee(getBorrowingRateWithDecay(), _LUSDDebt);
    }

    function _calcBorrowingFee(uint _borrowingRate, uint _LUSDDebt) internal pure returns (uint) {
        return _borrowingRate.mul(_LUSDDebt).div(DECIMAL_PRECISION);
    }


    // Updates the baseRate state variable based on time elapsed since the last redemption or LUSD borrowing operation.
    function decayBaseRateFromBorrowing() external override {
        _requireCallerIsBorrowerOperations();

        uint decayedBaseRate = _calcDecayedBaseRate();
        assert(decayedBaseRate <= DECIMAL_PRECISION);  // The baseRate can decay to 0

        baseRate = decayedBaseRate;
        emit BaseRateUpdated(decayedBaseRate);

        _updateLastFeeOpTime();
    }

    // --- Internal fee functions ---

    // Update the last fee operation time only if time passed >= decay interval. This prevents base rate griefing.
    function _updateLastFeeOpTime() internal {
        uint timePassed = block.timestamp.sub(lastFeeOperationTime);

        if (timePassed >= SECONDS_IN_ONE_MINUTE) {
            lastFeeOperationTime = block.timestamp;
            emit LastFeeOpTimeUpdated(block.timestamp);
        }
    }

    function _calcDecayedBaseRate() internal view returns (uint) {
        uint minutesPassed = _minutesPassedSinceLastFeeOp();
        uint decayFactor = LiquityMath._decPow(MINUTE_DECAY_FACTOR, minutesPassed);

        return baseRate.mul(decayFactor).div(DECIMAL_PRECISION);
    }

    function _minutesPassedSinceLastFeeOp() internal view returns (uint) {
        return (block.timestamp.sub(lastFeeOperationTime)).div(SECONDS_IN_ONE_MINUTE);
    }

    // --- 'require' wrapper functions ---

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress);
    }

    function _requireCallerIsRedemptionHelper() internal view {
        require(msg.sender == address(redemptionHelper));
    }

    function _requireCallerIsBorrowerOperationsOrRedemptionHelper() internal view {
        require(msg.sender == borrowerOperationsAddress || msg.sender == address(redemptionHelper));
    }

    function _requireTroveIsActive(address _borrower, address _collateral) internal view {
        require(Troves[_borrower][_collateral].status == Status.active);
    }

    function _requireMoreThanOneTroveInSystem(uint TroveOwnersArrayLength, address _collateral) internal view {
        require (TroveOwnersArrayLength > 1 && sortedTroves.getSize(_collateral) > 1);
    }

    // --- Trove property getters ---

    function getTroveStatus(address _borrower, address _collateral) external view override returns (uint) {
        return uint(Troves[_borrower][_collateral].status);
    }

    function getTroveStake(address _borrower, address _collateral) external view override returns (uint) {
        return Troves[_borrower][_collateral].stake;
    }

    function getTroveDebt(address _borrower, address _collateral) external view override returns (uint) {
        return Troves[_borrower][_collateral].debt;
    }

    function getTroveColl(address _borrower, address _collateral) external view override returns (uint) {
        return Troves[_borrower][_collateral].coll;
    }

    // --- Trove property setters, called by BorrowerOperations ---

    function setTroveStatus(address _borrower, address _collateral, uint _num) external override {
        _requireCallerIsBorrowerOperations();
        Troves[_borrower][_collateral].status = Status(_num);
    }

    function increaseTroveColl(address _borrower, address _collateral, uint _collIncrease) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newColl = Troves[_borrower][_collateral].coll.add(_collIncrease);
        Troves[_borrower][_collateral].coll = newColl;
        return newColl;
    }

    function decreaseTroveColl(address _borrower, address _collateral, uint _collDecrease) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newColl = Troves[_borrower][_collateral].coll.sub(_collDecrease);
        Troves[_borrower][_collateral].coll = newColl;
        return newColl;
    }

    function increaseTroveDebt(address _borrower, address _collateral, uint _debtIncrease) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newDebt = Troves[_borrower][_collateral].debt.add(_debtIncrease);
        Troves[_borrower][_collateral].debt = newDebt;
        return newDebt;
    }

    function decreaseTroveDebt(address _borrower, address _collateral, uint _debtDecrease) external override returns (uint) {
        _requireCallerIsBorrowerOperations();
        uint newDebt = Troves[_borrower][_collateral].debt.sub(_debtDecrease);
        Troves[_borrower][_collateral].debt = newDebt;
        return newDebt;
    }
}
