// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import './Interfaces/IBorrowerOperations.sol';
import "./Interfaces/ICollateralConfig.sol";
import './Interfaces/IStabilityPool.sol';
import './Interfaces/IBorrowerOperations.sol';
import './Interfaces/ITroveManager.sol';
import './Interfaces/ILUSDToken.sol';
import './Interfaces/ISortedTroves.sol';
import "./Interfaces/ICommunityIssuance.sol";
import "./Dependencies/LiquityBase.sol";
import "./Dependencies/SafeMath.sol";
import "./Dependencies/LiquitySafeMath128.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/console.sol";
import "./Dependencies/SafeERC20.sol";

/*
 * The Stability Pool holds LUSD tokens deposited by Stability Pool depositors.
 *
 * When a trove is liquidated, then depending on system conditions, some of its LUSD debt gets offset with
 * LUSD in the Stability Pool:  that is, the offset debt evaporates, and an equal amount of LUSD tokens in the Stability Pool is burned.
 *
 * Thus, a liquidation causes each depositor to receive a LUSD loss, in proportion to their deposit as a share of total deposits.
 * They also receive a collateral gain, as the collateral of the liquidated trove is distributed among Stability depositors,
 * in the same proportion.
 *
 * When a liquidation occurs, it depletes every deposit by the same fraction: for example, a liquidation that depletes 40%
 * of the total LUSD in the Stability Pool, depletes 40% of each deposit.
 *
 * A deposit that has experienced a series of liquidations is termed a "compounded deposit": each liquidation depletes the deposit,
 * multiplying it by some factor in range ]0,1[
 *
 *
 * --- IMPLEMENTATION ---
 *
 * We use a highly scalable method of tracking deposits and collateral gains that has O(1) complexity.
 *
 * When a liquidation occurs, rather than updating each depositor's deposit and collateral gain, we simply update two state variables:
 * a product P, and a sum S.
 *
 * A mathematical manipulation allows us to factor out the initial deposit, and accurately track all depositors' compounded deposits
 * and accumulated collateral gains over time, as liquidations occur, using just these two variables P and S. When depositors join the
 * Stability Pool, they get a snapshot of the latest P and S: P_t and S_t, respectively.
 *
 * The formula for a depositor's accumulated collateral gain is derived here:
 * https://github.com/liquity/dev/blob/main/packages/contracts/mathProofs/Scalable%20Compounding%20Stability%20Pool%20Deposits.pdf
 *
 * For a given deposit d_t, the ratio P/P_t tells us the factor by which a deposit has decreased since it joined the Stability Pool,
 * and the term d_t * (S - S_t)/P_t gives us the deposit's total accumulated collateral gain.
 *
 * Each liquidation updates the product P and sum S. After a series of liquidations, a compounded deposit and corresponding collateral gain
 * can be calculated using the initial deposit, the depositor’s snapshots of P and S, and the latest values of P and S.
 *
 * Any time a depositor updates their deposit (withdrawal, top-up) their accumulated collateral gain is paid out, their new deposit is recorded
 * (based on their latest compounded deposit and modified by the withdrawal/top-up), and they receive new snapshots of the latest P and S.
 * Essentially, they make a fresh deposit that overwrites the old one.
 *
 *
 * --- SCALE FACTOR ---
 *
 * Since P is a running product in range ]0,1] that is always-decreasing, it should never reach 0 when multiplied by a number in range ]0,1[.
 * Unfortunately, Solidity floor division always reaches 0, sooner or later.
 *
 * A series of liquidations that nearly empty the Pool (and thus each multiply P by a very small number in range ]0,1[ ) may push P
 * to its 18 digit decimal limit, and round it to 0, when in fact the Pool hasn't been emptied: this would break deposit tracking.
 *
 * So, to track P accurately, we use a scale factor: if a liquidation would cause P to decrease to <1e-9 (and be rounded to 0 by Solidity),
 * we first multiply P by 1e9, and increment a currentScale factor by 1.
 *
 * The added benefit of using 1e9 for the scale factor (rather than 1e18) is that it ensures negligible precision loss close to the 
 * scale boundary: when P is at its minimum value of 1e9, the relative precision loss in P due to floor division is only on the 
 * order of 1e-9. 
 *
 * --- EPOCHS ---
 *
 * Whenever a liquidation fully empties the Stability Pool, all deposits should become 0. However, setting P to 0 would make P be 0
 * forever, and break all future reward calculations.
 *
 * So, every time the Stability Pool is emptied by a liquidation, we reset P = 1 and currentScale = 0, and increment the currentEpoch by 1.
 *
 * --- TRACKING DEPOSIT OVER SCALE CHANGES AND EPOCHS ---
 *
 * When a deposit is made, it gets snapshots of the currentEpoch and the currentScale.
 *
 * When calculating a compounded deposit, we compare the current epoch to the deposit's epoch snapshot. If the current epoch is newer,
 * then the deposit was present during a pool-emptying liquidation, and necessarily has been depleted to 0.
 *
 * Otherwise, we then compare the current scale to the deposit's scale snapshot. If they're equal, the compounded deposit is given by d_t * P/P_t.
 * If it spans one scale change, it is given by d_t * P/(P_t * 1e9). If it spans more than one scale change, we define the compounded deposit
 * as 0, since it is now less than 1e-9'th of its initial value (e.g. a deposit of 1 billion LUSD has depleted to < 1 LUSD).
 *
 *
 *  --- TRACKING DEPOSITOR'S COLLATERAL GAIN OVER SCALE CHANGES AND EPOCHS ---
 *
 * In the current epoch, the latest value of S is stored upon each scale change, and the mapping (scale -> S) is stored for each epoch.
 *
 * This allows us to calculate a deposit's accumulated collateral gain, during the epoch in which the deposit was non-zero and earned collateral.
 *
 * We calculate the depositor's accumulated collateral gain for the scale at which they made the deposit, using the collateral gain formula:
 * e_1 = d_t * (S - S_t) / P_t
 *
 * and also for scale after, taking care to divide the latter by a factor of 1e9:
 * e_2 = d_t * S / (P_t * 1e9)
 *
 * The gain in the second scale will be full, as the starting point was in the previous scale, thus no need to subtract anything.
 * The deposit therefore was present for reward events from the beginning of that second scale.
 *
 *        S_i-S_t + S_{i+1}
 *      .<--------.------------>
 *      .         .
 *      . S_i     .   S_{i+1}
 *   <--.-------->.<----------->
 *   S_t.         .
 *   <->.         .
 *      t         .
 *  |---+---------|-------------|-----...
 *         i            i+1
 *
 * The sum of (e_1 + e_2) captures the depositor's total accumulated collateral gain, handling the case where their
 * deposit spanned one scale change. We only care about gains across one scale change, since the compounded
 * deposit is defined as being 0 once it has spanned more than one scale change.
 *
 *
 * --- UPDATING P WHEN A LIQUIDATION OCCURS ---
 *
 * Please see the implementation spec in the proof document, which closely follows on from the compounded deposit / collateral gain derivations:
 * https://github.com/liquity/liquity/blob/master/papers/Scalable_Reward_Distribution_with_Compounding_Stakes.pdf
 *
 *
 * --- LQTY ISSUANCE TO STABILITY POOL DEPOSITORS ---
 *
 * An LQTY issuance event occurs at every deposit operation, and every liquidation. All deposits earn a share of the issued LQTY
 * in proportion to the deposit as a share of total deposits.
 *
 * Please see the system Readme for an overview:
 * https://github.com/liquity/dev/blob/main/README.md#lqty-issuance-to-stability-providers
 *
 * We use the same mathematical product-sum approach to track LQTY gains for depositors, where 'G' is the sum corresponding to LQTY gains.
 * The product P (and snapshot P_t) is re-used, as the ratio P/P_t tracks a deposit's depletion due to liquidations.
 *
 */
contract StabilityPool is LiquityBase, Ownable, CheckContract, IStabilityPool {
    using LiquitySafeMath128 for uint128;
    using SafeERC20 for IERC20;

    string constant public NAME = "StabilityPool";

    IBorrowerOperations public borrowerOperations;

    ICollateralConfig public collateralConfig;

    ITroveManager public troveManager;

    ILUSDToken public lusdToken;

    address public lqtyTokenAddress;

    // Needed to check if there are pending liquidations
    ISortedTroves public sortedTroves;

    ICommunityIssuance public communityIssuance;

    mapping (address => uint256) internal collAmounts;  // deposited collateral tracker

    // Tracker for LUSD held in the pool. Changes when users deposit/withdraw, and when Trove debt is offset.
    uint256 internal totalLUSDDeposits;

   // --- Data structures ---

    struct Deposit {
        uint initialValue;
    }

    struct Snapshots {
        mapping (address => uint) S;
        uint P;
        uint G;
        uint128 scale;
        uint128 epoch;
    }

    mapping (address => Deposit) public deposits;  // depositor address -> Deposit struct
    mapping (address => Snapshots) public depositSnapshots;  // depositor address -> snapshots struct

    /*  Product 'P': Running product by which to multiply an initial deposit, in order to find the current compounded deposit,
    * after a series of liquidations have occurred, each of which cancel some LUSD debt with the deposit.
    *
    * During its lifetime, a deposit's value evolves from d_t to d_t * P / P_t , where P_t
    * is the snapshot of P taken at the instant the deposit was made. 18-digit decimal.
    */
    uint public P = DECIMAL_PRECISION;

    uint public constant SCALE_FACTOR = 1e9;

    // Each time the scale of P shifts by SCALE_FACTOR, the scale is incremented by 1
    uint128 public currentScale;

    // With each offset that fully empties the Pool, the epoch is incremented by 1
    uint128 public currentEpoch;

    /* Collateral Gain sum 'S': During its lifetime, each deposit d_t earns a collateral gain of ( d_t * [S - S_t] )/P_t, where S_t
    * is the depositor's snapshot of S taken at the time t when the deposit was made.
    *
    * The 'S' sums are stored in a nested mapping (epoch => scale => collateral => sum):
    *
    * - The inner mapping records the sum S for each collateral
    * - The middle mapping records the (collateral => sum) mappings, at different scales.
    * - The outer mapping records the (scale => collateral => sum) mappings, for different epochs.
    */
    mapping (uint128 => mapping(uint128 => mapping (address => uint))) public epochToScaleToSum;

    /*
    * Similarly, the sum 'G' is used to calculate LQTY gains. During it's lifetime, each deposit d_t earns a LQTY gain of
    *  ( d_t * [G - G_t] )/P_t, where G_t is the depositor's snapshot of G taken at time t when  the deposit was made.
    *
    *  LQTY reward events occur are triggered by depositor operations (new deposit, topup, withdrawal), and liquidations.
    *  In each case, the LQTY reward is issued (i.e. G is updated), before other state changes are made.
    */
    mapping (uint128 => mapping(uint128 => uint)) public epochToScaleToG;

    // Error tracker for the error correction in the LQTY issuance calculation
    uint public lastLQTYError;
    // Error trackers for the error correction in the offset calculation
    mapping (address => uint) public lastCollateralError_Offset;
    uint public lastLUSDLossError_Offset;

    // --- Events ---

    event StabilityPoolCollateralBalanceUpdated(address _collateral, uint _newBalance);
    event StabilityPoolLUSDBalanceUpdated(uint _newBalance);

    event BorrowerOperationsAddressChanged(address _newBorrowerOperationsAddress);
    event CollateralConfigAddressChanged(address _newCollateralConfigAddress);
    event TroveManagerAddressChanged(address _newTroveManagerAddress);
    event ActivePoolAddressChanged(address _newActivePoolAddress);
    event DefaultPoolAddressChanged(address _newDefaultPoolAddress);
    event LUSDTokenAddressChanged(address _newLUSDTokenAddress);
    event SortedTrovesAddressChanged(address _newSortedTrovesAddress);
    event PriceFeedAddressChanged(address _newPriceFeedAddress);
    event CommunityIssuanceAddressChanged(address _newCommunityIssuanceAddress);

    event P_Updated(uint _P);
    event S_Updated(address _collateral, uint _S, uint128 _epoch, uint128 _scale);
    event G_Updated(uint _G, uint128 _epoch, uint128 _scale);
    event EpochUpdated(uint128 _currentEpoch);
    event ScaleUpdated(uint128 _currentScale);

    event DepositSnapshotUpdated(address indexed _depositor, uint _P, address[] _assets, uint[] _amounts, uint _G);
    event UserDepositChanged(address indexed _depositor, uint _newDeposit);

    event CollateralGainWithdrawn(address indexed _depositor, address _collateral, uint _collAmount);
    event LQTYPaidToDepositor(address indexed _depositor, uint _LQTY);
    event CollateralSent(address _collateral, address _to, uint _amount);

    // --- Contract setters ---

    function setAddresses(
        address _borrowerOperationsAddress,
        address _collateralConfigAddress,
        address _troveManagerAddress,
        address _activePoolAddress,
        address _lusdTokenAddress,
        address _sortedTrovesAddress,
        address _priceFeedAddress,
        address _communityIssuanceAddress
    )
        external
        override
        onlyOwner
    {
        checkContract(_borrowerOperationsAddress);
        checkContract(_collateralConfigAddress);
        checkContract(_troveManagerAddress);
        checkContract(_activePoolAddress);
        checkContract(_lusdTokenAddress);
        checkContract(_sortedTrovesAddress);
        checkContract(_priceFeedAddress);
        checkContract(_communityIssuanceAddress);

        borrowerOperations = IBorrowerOperations(_borrowerOperationsAddress);
        collateralConfig = ICollateralConfig(_collateralConfigAddress);
        troveManager = ITroveManager(_troveManagerAddress);
        activePool = IActivePool(_activePoolAddress);
        lusdToken = ILUSDToken(_lusdTokenAddress);
        sortedTroves = ISortedTroves(_sortedTrovesAddress);
        priceFeed = IPriceFeed(_priceFeedAddress);
        communityIssuance = ICommunityIssuance(_communityIssuanceAddress);

        emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
        emit CollateralConfigAddressChanged(_collateralConfigAddress);
        emit TroveManagerAddressChanged(_troveManagerAddress);
        emit ActivePoolAddressChanged(_activePoolAddress);
        emit LUSDTokenAddressChanged(_lusdTokenAddress);
        emit SortedTrovesAddressChanged(_sortedTrovesAddress);
        emit PriceFeedAddressChanged(_priceFeedAddress);
        emit CommunityIssuanceAddressChanged(_communityIssuanceAddress);

        _renounceOwnership();
    }

    // --- Getters for public variables. Required by IPool interface ---

    function getCollateral(address _collateral) external view override returns (uint) {
        return collAmounts[_collateral];
    }

    function getTotalLUSDDeposits() external view override returns (uint) {
        return totalLUSDDeposits;
    }

    // --- External Depositor Functions ---

    /*  provideToSP():
    *
    * - Triggers a LQTY issuance, based on time passed since the last issuance. The LQTY issuance is shared between *all* depositors
    * - Sends depositor's accumulated gains to depositor
    * - Increases depositor's deposit, and takes new snapshot.
    */
    function provideToSP(uint _amount) external override {
        _requireNonZeroAmount(_amount);

        uint initialDeposit = deposits[msg.sender].initialValue;

        ICommunityIssuance communityIssuanceCached = communityIssuance;

        _triggerLQTYIssuance(communityIssuanceCached);

        (address[] memory assets, uint[] memory amounts) = getDepositorCollateralGain(msg.sender);
        uint compoundedLUSDDeposit = getCompoundedLUSDDeposit(msg.sender);

        /* TODO tess3rac7 unused var, but previously included in ETHGainWithdrawn event log.
         * Doesn't make a lot of sense to include in multiple CollateralGainWithdrawn logs.
         * If needed could create a separate event just to report this.
         */
        uint LUSDLoss = initialDeposit.sub(compoundedLUSDDeposit); // Needed only for event log

        // First pay out any LQTY gains
        _payOutLQTYGains(communityIssuanceCached, msg.sender);

        _sendLUSDtoStabilityPool(msg.sender, _amount);

        uint newDeposit = compoundedLUSDDeposit.add(_amount);
        _updateDepositAndSnapshots(msg.sender, newDeposit);
        emit UserDepositChanged(msg.sender, newDeposit);

        uint numCollaterals = assets.length;
        for (uint i = 0; i < numCollaterals; i++) {
            address collateral = assets[i];
            uint amount = amounts[i];
            emit CollateralGainWithdrawn(msg.sender, collateral, amount);
            _sendCollateralGainToDepositor(collateral, amount);
        }
     }

    /*  withdrawFromSP():
    *
    * - Triggers a LQTY issuance, based on time passed since the last issuance. The LQTY issuance is shared between *all* depositors
    * - Sends all depositor's accumulated gains to depositor
    * - Decreases depositor's deposit, and takes new snapshot.
    *
    * If _amount > userDeposit, the user withdraws all of their compounded deposit.
    */
    function withdrawFromSP(uint _amount) external override {
        if (_amount !=0) {_requireNoUnderCollateralizedTroves();}
        uint initialDeposit = deposits[msg.sender].initialValue;
        _requireUserHasDeposit(initialDeposit);

        ICommunityIssuance communityIssuanceCached = communityIssuance;

        _triggerLQTYIssuance(communityIssuanceCached);

        (address[] memory assets, uint[] memory amounts) = getDepositorCollateralGain(msg.sender);
        uint compoundedLUSDDeposit = getCompoundedLUSDDeposit(msg.sender);
        uint LUSDtoWithdraw = LiquityMath._min(_amount, compoundedLUSDDeposit);

        /* TODO tess3rac7 unused var, but previously included in ETHGainWithdrawn event log.
         * Doesn't make a lot of sense to include in multiple CollateralGainWithdrawn logs.
         * If needed could create a separate event just to report this.
         */
        uint LUSDLoss = initialDeposit.sub(compoundedLUSDDeposit); // Needed only for event log

        // First pay out any LQTY gains
        _payOutLQTYGains(communityIssuanceCached, msg.sender);
        
        _sendLUSDToDepositor(msg.sender, LUSDtoWithdraw);

        // Update deposit
        uint newDeposit = compoundedLUSDDeposit.sub(LUSDtoWithdraw);
        _updateDepositAndSnapshots(msg.sender, newDeposit);
        emit UserDepositChanged(msg.sender, newDeposit);

        uint numCollaterals = assets.length;
        for (uint i = 0; i < numCollaterals; i++) {
            address collateral = assets[i];
            uint amount = amounts[i];
            emit CollateralGainWithdrawn(msg.sender, collateral, amount);
            _sendCollateralGainToDepositor(collateral, amount);
        }
    }

    /*
     * A depositor's snapshot struct now contains a mapping for the running sum (S) for each collateral.
     * Mappings within a struct are not accessible via the auto-generated getters in the ABI, so we provide
     * this separate function that will return the specified depositor's "S" snapshot for the given collateral.
     */
    function depositSnapshots_S(address _depositor, address _collateral) external override view returns (uint) {
        return depositSnapshots[_depositor].S[_collateral];
    }

    // --- LQTY issuance functions ---

    function _triggerLQTYIssuance(ICommunityIssuance _communityIssuance) internal {
        uint LQTYIssuance = _communityIssuance.issueOath();
       _updateG(LQTYIssuance);
    }

    function _updateG(uint _LQTYIssuance) internal {
        uint totalLUSD = totalLUSDDeposits; // cached to save an SLOAD
        /*
        * When total deposits is 0, G is not updated. In this case, the LQTY issued can not be obtained by later
        * depositors - it is missed out on, and remains in the balanceof the CommunityIssuance contract.
        *
        */
        if (totalLUSD == 0 || _LQTYIssuance == 0) {return;}

        uint LQTYPerUnitStaked;
        LQTYPerUnitStaked =_computeLQTYPerUnitStaked(_LQTYIssuance, totalLUSD);

        uint marginalLQTYGain = LQTYPerUnitStaked.mul(P);
        epochToScaleToG[currentEpoch][currentScale] = epochToScaleToG[currentEpoch][currentScale].add(marginalLQTYGain);

        emit G_Updated(epochToScaleToG[currentEpoch][currentScale], currentEpoch, currentScale);
    }

    function _computeLQTYPerUnitStaked(uint _LQTYIssuance, uint _totalLUSDDeposits) internal returns (uint) {
        /*  
        * Calculate the LQTY-per-unit staked.  Division uses a "feedback" error correction, to keep the 
        * cumulative error low in the running total G:
        *
        * 1) Form a numerator which compensates for the floor division error that occurred the last time this 
        * function was called.  
        * 2) Calculate "per-unit-staked" ratio.
        * 3) Multiply the ratio back by its denominator, to reveal the current floor division error.
        * 4) Store this error for use in the next correction when this function is called.
        * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
        */
        uint LQTYNumerator = _LQTYIssuance.mul(DECIMAL_PRECISION).add(lastLQTYError);

        uint LQTYPerUnitStaked = LQTYNumerator.div(_totalLUSDDeposits);
        lastLQTYError = LQTYNumerator.sub(LQTYPerUnitStaked.mul(_totalLUSDDeposits));

        return LQTYPerUnitStaked;
    }

    // --- Liquidation functions ---

    /*
    * Cancels out the specified debt against the LUSD contained in the Stability Pool (as far as possible)
    * and transfers the Trove's collateral from ActivePool to StabilityPool.
    * Only called by liquidation functions in the TroveManager.
    */
    function offset(address _collateral, uint _debtToOffset, uint _collToAdd) external override {
        _requireCallerIsTroveManager();
        uint totalLUSD = totalLUSDDeposits; // cached to save an SLOAD
        if (totalLUSD == 0 || _debtToOffset == 0) { return; }

        _triggerLQTYIssuance(communityIssuance);

        (uint collGainPerUnitStaked,
            uint LUSDLossPerUnitStaked) = _computeRewardsPerUnitStaked(_collateral, _collToAdd, _debtToOffset, totalLUSD);

        _updateRewardSumAndProduct(_collateral, collGainPerUnitStaked, LUSDLossPerUnitStaked);  // updates S and P

        _moveOffsetCollAndDebt(_collateral, _collToAdd, _debtToOffset);
    }

    /*
    * Updates the reward sum for the specified collateral. A trimmed down version of "offset()" that doesn't
    * concern itself with any debt to offset or LUSD loss. Only called by ActivePool when distributing
    * yield farming rewards.
    */
    function updateRewardSum(address _collateral, uint _collToAdd) external override {
        _requireCallerIsActivePool();
        uint totalLUSD = totalLUSDDeposits; // cached to save an SLOAD
        if (totalLUSD == 0) { return; }

        _triggerLQTYIssuance(communityIssuance);

        (uint collGainPerUnitStaked, ) = _computeRewardsPerUnitStaked(_collateral, _collToAdd, 0, totalLUSD);

        _updateRewardSumAndProduct(_collateral, collGainPerUnitStaked, 0);  // updates S

        uint sum = collAmounts[_collateral].add(_collToAdd);
        collAmounts[_collateral] = sum;
        emit StabilityPoolCollateralBalanceUpdated(_collateral, sum);
    }

    // --- Offset helper functions ---

    function _computeRewardsPerUnitStaked(
        address _collateral,
        uint _collToAdd,
        uint _debtToOffset,
        uint _totalLUSDDeposits
    )
        internal
        returns (uint collGainPerUnitStaked, uint LUSDLossPerUnitStaked)
    {
        /*
        * Compute the LUSD and collateral rewards. Uses a "feedback" error correction, to keep
        * the cumulative error in the P and S state variables low:
        *
        * 1) Form numerators which compensate for the floor division errors that occurred the last time this 
        * function was called.  
        * 2) Calculate "per-unit-staked" ratios.
        * 3) Multiply each ratio back by its denominator, to reveal the current floor division error.
        * 4) Store these errors for use in the next correction when this function is called.
        * 5) Note: static analysis tools complain about this "division before multiplication", however, it is intended.
        */
        uint collNumerator = _collToAdd.mul(DECIMAL_PRECISION).add(lastCollateralError_Offset[_collateral]);

        assert(_debtToOffset <= _totalLUSDDeposits);
        if (_debtToOffset == _totalLUSDDeposits) {
            LUSDLossPerUnitStaked = DECIMAL_PRECISION;  // When the Pool depletes to 0, so does each deposit 
            lastLUSDLossError_Offset = 0;
        } else {
            uint LUSDLossNumerator = _debtToOffset.mul(DECIMAL_PRECISION).sub(lastLUSDLossError_Offset);
            /*
            * Add 1 to make error in quotient positive. We want "slightly too much" LUSD loss,
            * which ensures the error in any given compoundedLUSDDeposit favors the Stability Pool.
            */
            LUSDLossPerUnitStaked = (LUSDLossNumerator.div(_totalLUSDDeposits)).add(1);
            lastLUSDLossError_Offset = (LUSDLossPerUnitStaked.mul(_totalLUSDDeposits)).sub(LUSDLossNumerator);
        }

        collGainPerUnitStaked = collNumerator.div(_totalLUSDDeposits);
        lastCollateralError_Offset[_collateral] = collNumerator.sub(collGainPerUnitStaked.mul(_totalLUSDDeposits));

        return (collGainPerUnitStaked, LUSDLossPerUnitStaked);
    }

    // Update the Stability Pool reward sum S and product P
    function _updateRewardSumAndProduct(address _collateral, uint _collGainPerUnitStaked, uint _LUSDLossPerUnitStaked) internal {
        uint currentP = P;
        uint newP;

        assert(_LUSDLossPerUnitStaked <= DECIMAL_PRECISION);
        /*
        * The newProductFactor is the factor by which to change all deposits, due to the depletion of Stability Pool LUSD in the liquidation.
        * We make the product factor 0 if there was a pool-emptying. Otherwise, it is (1 - LUSDLossPerUnitStaked)
        */
        uint newProductFactor = uint(DECIMAL_PRECISION).sub(_LUSDLossPerUnitStaked);

        uint128 currentScaleCached = currentScale;
        uint128 currentEpochCached = currentEpoch;
        uint currentS = epochToScaleToSum[currentEpochCached][currentScaleCached][_collateral];

        /*
        * Calculate the new S first, before we update P.
        * The collateral gain for any given depositor from a liquidation depends on the value of their deposit
        * (and the value of totalDeposits) prior to the Stability being depleted by the debt in the liquidation.
        *
        * Since S corresponds to collateral gain, and P to deposit loss, we update S first.
        */
        uint marginalCollGain = _collGainPerUnitStaked.mul(currentP);
        uint newS = currentS.add(marginalCollGain);
        epochToScaleToSum[currentEpochCached][currentScaleCached][_collateral] = newS;
        emit S_Updated(_collateral, newS, currentEpochCached, currentScaleCached);

        // If the Stability Pool was emptied, increment the epoch, and reset the scale and product P
        if (newProductFactor == 0) {
            currentEpoch = currentEpochCached.add(1);
            emit EpochUpdated(currentEpoch);
            currentScale = 0;
            emit ScaleUpdated(currentScale);
            newP = DECIMAL_PRECISION;

        // If multiplying P by a non-zero product factor would reduce P below the scale boundary, increment the scale
        } else if (currentP.mul(newProductFactor).div(DECIMAL_PRECISION) < SCALE_FACTOR) {
            newP = currentP.mul(newProductFactor).mul(SCALE_FACTOR).div(DECIMAL_PRECISION); 
            currentScale = currentScaleCached.add(1);
            emit ScaleUpdated(currentScale);
        } else {
            newP = currentP.mul(newProductFactor).div(DECIMAL_PRECISION);
        }

        assert(newP > 0);
        P = newP;

        emit P_Updated(newP);
    }

    function _moveOffsetCollAndDebt(address _collateral, uint _collToAdd, uint _debtToOffset) internal {
        IActivePool activePoolCached = activePool;

        // Cancel the liquidated LUSD debt with the LUSD in the stability pool
        activePoolCached.decreaseLUSDDebt(_collateral, _debtToOffset);
        _decreaseLUSD(_debtToOffset);

        // Burn the debt that was successfully offset
        lusdToken.burn(address(this), _debtToOffset);

        activePoolCached.sendCollateral(_collateral, address(this), _collToAdd);
        uint sum = collAmounts[_collateral].add(_collToAdd);
        collAmounts[_collateral] = sum;
        emit StabilityPoolCollateralBalanceUpdated(_collateral, sum);
    }

    function _decreaseLUSD(uint _amount) internal {
        uint newTotalLUSDDeposits = totalLUSDDeposits.sub(_amount);
        totalLUSDDeposits = newTotalLUSDDeposits;
        emit StabilityPoolLUSDBalanceUpdated(newTotalLUSDDeposits);
    }

    // --- Reward calculator functions for depositor ---

    /* Calculates the collateral gain earned by the deposit since its last snapshots were taken.
    * Given by the formula:  E = d0 * (S - S(0))/P(0)
    * where S(0) and P(0) are the depositor's snapshots of the sum S and product P, respectively.
    * d0 is the last recorded deposit value.
    */
    function getDepositorCollateralGain(address _depositor) public view override returns (address[] memory assets, uint[] memory amounts) {
        uint initialDeposit = deposits[_depositor].initialValue;

        if (initialDeposit != 0) { 
            Snapshots storage snapshots = depositSnapshots[_depositor];

            return _getCollateralGainFromSnapshots(initialDeposit, snapshots);
        }

    }

    function _getCollateralGainFromSnapshots(uint initialDeposit, Snapshots storage snapshots) internal view returns (address[] memory assets, uint[] memory amounts) {
        assets = collateralConfig.getAllowedCollaterals();
        amounts = new uint[](assets.length);
        for (uint i = 0; i < assets.length; i++) {
            amounts[i] = _getSingularCollateralGain(initialDeposit, assets[i], snapshots);
        }
    }

    // Due to "stack too deep" error
    struct LocalVariables_getSingularCollateralGain {
        uint256 collDecimals;
        uint128 epochSnapshot;
        uint128 scaleSnapshot;
        uint P_Snapshot;
        uint S_Snapshot;
        uint firstPortion;
        uint secondPortion;
        uint gain;
    }

    function _getSingularCollateralGain(uint _initialDeposit, address _collateral, Snapshots storage _snapshots) internal view returns (uint) {
        /*
        * Grab the sum 'S' from the epoch at which the stake was made. The collateral gain may span up to one scale change.
        * If it does, the second portion of the collateral gain is scaled by 1e9.
        * If the gain spans no scale change, the second portion will be 0.
        */
        LocalVariables_getSingularCollateralGain memory vars;
        vars.collDecimals = collateralConfig.getCollateralDecimals(_collateral);
        vars.epochSnapshot = _snapshots.epoch;
        vars.scaleSnapshot = _snapshots.scale;
        vars.P_Snapshot = _snapshots.P;
        vars.S_Snapshot = _snapshots.S[_collateral];

        vars.firstPortion = epochToScaleToSum[vars.epochSnapshot][vars.scaleSnapshot][_collateral].sub(vars.S_Snapshot);
        vars.secondPortion = epochToScaleToSum[vars.epochSnapshot][vars.scaleSnapshot.add(1)][_collateral].div(SCALE_FACTOR);

        vars.gain = _initialDeposit.mul(vars.firstPortion.add(vars.secondPortion)).div(vars.P_Snapshot).div(DECIMAL_PRECISION);
        return vars.gain;
    }

    /*
    * Calculate the LQTY gain earned by a deposit since its last snapshots were taken.
    * Given by the formula:  LQTY = d0 * (G - G(0))/P(0)
    * where G(0) and P(0) are the depositor's snapshots of the sum G and product P, respectively.
    * d0 is the last recorded deposit value.
    */
    function getDepositorLQTYGain(address _depositor) public view override returns (uint) {
        uint initialDeposit = deposits[_depositor].initialValue;
        if (initialDeposit == 0) {return 0;}

        Snapshots memory snapshots = depositSnapshots[_depositor];
        uint LQTYGain = _getLQTYGainFromSnapshots(initialDeposit, snapshots);

        return LQTYGain;
    }

    function _getLQTYGainFromSnapshots(uint initialDeposit, Snapshots memory snapshots) internal view returns (uint) {
       /*
        * Grab the sum 'G' from the epoch at which the stake was made. The LQTY gain may span up to one scale change.
        * If it does, the second portion of the LQTY gain is scaled by 1e9.
        * If the gain spans no scale change, the second portion will be 0.
        */
        uint128 epochSnapshot = snapshots.epoch;
        uint128 scaleSnapshot = snapshots.scale;
        uint G_Snapshot = snapshots.G;
        uint P_Snapshot = snapshots.P;

        uint firstPortion = epochToScaleToG[epochSnapshot][scaleSnapshot].sub(G_Snapshot);
        uint secondPortion = epochToScaleToG[epochSnapshot][scaleSnapshot.add(1)].div(SCALE_FACTOR);

        uint LQTYGain = initialDeposit.mul(firstPortion.add(secondPortion)).div(P_Snapshot).div(DECIMAL_PRECISION);

        return LQTYGain;
    }

    // --- Compounded deposit ---

    /*
    * Return the user's compounded deposit. Given by the formula:  d = d0 * P/P(0)
    * where P(0) is the depositor's snapshot of the product P, taken when they last updated their deposit.
    */
    function getCompoundedLUSDDeposit(address _depositor) public view override returns (uint) {
        uint initialDeposit = deposits[_depositor].initialValue;
        if (initialDeposit == 0) { return 0; }

        Snapshots memory snapshots = depositSnapshots[_depositor];

        uint compoundedDeposit = _getCompoundedDepositFromSnapshots(initialDeposit, snapshots);
        return compoundedDeposit;
    }

    // Internal function, used to calculcate compounded deposits.
    function _getCompoundedDepositFromSnapshots(
        uint initialDeposit,
        Snapshots memory snapshots
    )
        internal
        view
        returns (uint)
    {
        uint snapshot_P = snapshots.P;
        uint128 scaleSnapshot = snapshots.scale;
        uint128 epochSnapshot = snapshots.epoch;

        // If deposit was made before a pool-emptying event, then it has been fully cancelled with debt -- so, return 0
        if (epochSnapshot < currentEpoch) { return 0; }

        uint compoundedDeposit;
        uint128 scaleDiff = currentScale.sub(scaleSnapshot);

        /* Compute the compounded deposit. If a scale change in P was made during the deposit's lifetime,
        * account for it. If more than one scale change was made, then the deposit has decreased by a factor of
        * at least 1e-9 -- so return 0.
        */
        if (scaleDiff == 0) {
            compoundedDeposit = initialDeposit.mul(P).div(snapshot_P);
        } else if (scaleDiff == 1) {
            compoundedDeposit = initialDeposit.mul(P).div(snapshot_P).div(SCALE_FACTOR);
        } else { // if scaleDiff >= 2
            compoundedDeposit = 0;
        }

        /*
        * If compounded deposit is less than a billionth of the initial deposit, return 0.
        *
        * NOTE: originally, this line was in place to stop rounding errors making the deposit too large. However, the error
        * corrections should ensure the error in P "favors the Pool", i.e. any given compounded deposit should slightly less
        * than it's theoretical value.
        *
        * Thus it's unclear whether this line is still really needed.
        */
        if (compoundedDeposit < initialDeposit.div(1e9)) {return 0;}

        return compoundedDeposit;
    }

    // --- Sender functions for LUSD deposit, ETH gains and LQTY gains ---

    // Transfer the LUSD tokens from the user to the Stability Pool's address, and update its recorded LUSD
    function _sendLUSDtoStabilityPool(address _address, uint _amount) internal {
        lusdToken.sendToPool(_address, address(this), _amount);
        uint newTotalLUSDDeposits = totalLUSDDeposits.add(_amount);
        totalLUSDDeposits = newTotalLUSDDeposits;
        emit StabilityPoolLUSDBalanceUpdated(newTotalLUSDDeposits);
    }

    function _sendCollateralGainToDepositor(address _collateral, uint _amount) internal {
        if (_amount == 0) {return;}
        uint newCollAmount = collAmounts[_collateral].sub(_amount);
        collAmounts[_collateral] = newCollAmount;
        emit StabilityPoolCollateralBalanceUpdated(_collateral, newCollAmount);
        emit CollateralSent(_collateral, msg.sender, _amount);

        IERC20(_collateral).safeTransfer(msg.sender, _amount);
    }

    // Send LUSD to user and decrease LUSD in Pool
    function _sendLUSDToDepositor(address _depositor, uint LUSDWithdrawal) internal {
        if (LUSDWithdrawal == 0) {return;}

        lusdToken.returnFromPool(address(this), _depositor, LUSDWithdrawal);
        _decreaseLUSD(LUSDWithdrawal);
    }

    // --- Stability Pool Deposit Functionality ---

    function _updateDepositAndSnapshots(address _depositor, uint _newValue) internal {
        deposits[_depositor].initialValue = _newValue;

        address[] memory collaterals = collateralConfig.getAllowedCollaterals();
        uint[] memory amounts = new uint[](collaterals.length);

        if (_newValue == 0) {
            for (uint i = 0; i < collaterals.length; i++) {
                delete depositSnapshots[_depositor].S[collaterals[i]];
            }
            delete depositSnapshots[_depositor];
            emit DepositSnapshotUpdated(_depositor, 0, collaterals, amounts, 0);
            return;
        }
        uint128 currentScaleCached = currentScale;
        uint128 currentEpochCached = currentEpoch;
        uint currentP = P;

        // Get G for the current epoch and current scale
        uint currentG = epochToScaleToG[currentEpochCached][currentScaleCached];

        // Record new snapshots of the latest running product P, and sum G, for the depositor
        depositSnapshots[_depositor].P = currentP;
        depositSnapshots[_depositor].G = currentG;
        depositSnapshots[_depositor].scale = currentScaleCached;
        depositSnapshots[_depositor].epoch = currentEpochCached;

        // Record new snapshots of the latest running sum S for all collaterals for the depositor
        for (uint i = 0; i < collaterals.length; i++) {
            address collateral = collaterals[i];
            uint currentS = epochToScaleToSum[currentEpochCached][currentScaleCached][collateral];
            depositSnapshots[_depositor].S[collateral] = currentS;
            amounts[i] = currentS;
        }
        emit DepositSnapshotUpdated(_depositor, currentP, collaterals, amounts, currentG);
    }

    function _payOutLQTYGains(ICommunityIssuance _communityIssuance, address _depositor) internal {
        uint depositorLQTYGain = getDepositorLQTYGain(_depositor);
        _communityIssuance.sendOath(_depositor, depositorLQTYGain);
        emit LQTYPaidToDepositor(_depositor, depositorLQTYGain);
    }

    // --- 'require' functions ---

    function _requireCallerIsActivePool() internal view {
        require( msg.sender == address(activePool), "StabilityPool: Caller is not ActivePool");
    }

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == address(troveManager), "StabilityPool: Caller is not TroveManager");
    }

    function _requireNoUnderCollateralizedTroves() internal {
        address[] memory collaterals = collateralConfig.getAllowedCollaterals();
        uint numCollaterals = collaterals.length;
        for (uint i = 0; i < numCollaterals; i++) {
            address collateral = collaterals[i];
            uint price = priceFeed.fetchPrice(collateral);
            address lowestTrove = sortedTroves.getLast(collateral);
            uint256 collMCR = collateralConfig.getCollateralMCR(collateral);
            uint ICR = troveManager.getCurrentICR(lowestTrove, collateral, price);
            require(ICR >= collMCR, "StabilityPool: Cannot withdraw while there are troves with ICR < MCR");
        }
    }

    function _requireUserHasDeposit(uint _initialDeposit) internal pure {
        require(_initialDeposit > 0, 'StabilityPool: User must have a non-zero deposit');
    }

    function _requireNonZeroAmount(uint _amount) internal pure {
        require(_amount > 0, 'StabilityPool: Amount must be non-zero');
    }
}
