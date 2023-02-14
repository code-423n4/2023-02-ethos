// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../CollateralConfig.sol";
import "../TroveManager.sol";
import "../RedemptionHelper.sol";
import "../BorrowerOperations.sol";
import "../ActivePool.sol";
import "../DefaultPool.sol";
import "../StabilityPool.sol";
import "../GasPool.sol";
import "../CollSurplusPool.sol";
import "../LUSDToken.sol";
import "./PriceFeedTestnet.sol";
import "../SortedTroves.sol";
import "./EchidnaProxy.sol";
import "../Dependencies/SafeERC20.sol";
//import "../Dependencies/console.sol";

// Run with:
// rm -f fuzzTests/corpus/* # (optional)
// ~/.local/bin/echidna-test contracts/TestContracts/EchidnaTester.sol --contract EchidnaTester --config fuzzTests/echidna_config.yaml

contract EchidnaTester {
    using SafeERC20 for IERC20;
    using SafeMath for uint;

    uint constant private NUMBER_OF_ACTORS = 100;
    uint constant private INITIAL_BALANCE = 1e24;
    uint private MCR;
    uint private CCR;
    uint private LUSD_GAS_COMPENSATION;

    CollateralConfig public collateralConfig;
    TroveManager public troveManager;
    RedemptionHelper public redemptionHelper;
    BorrowerOperations public borrowerOperations;
    ActivePool public activePool;
    DefaultPool public defaultPool;
    StabilityPool public stabilityPool;
    GasPool public gasPool;
    CollSurplusPool public collSurplusPool;
    LUSDToken public lusdToken;
    PriceFeedTestnet priceFeedTestnet;
    SortedTroves sortedTroves;
    address[] collaterals;
    address[] erc4626vaults;

    EchidnaProxy[NUMBER_OF_ACTORS] public echidnaProxies;

    uint private numberOfTroves;

    constructor(
        address _treasuryAddress,
        address _collateral,
        address _erc4626vault,
        address _governance,
        address _guardian
    ) public {
        collateralConfig = new CollateralConfig();
        troveManager = new TroveManager();
        redemptionHelper = new RedemptionHelper();
        borrowerOperations = new BorrowerOperations();
        activePool = new ActivePool();
        defaultPool = new DefaultPool();
        stabilityPool = new StabilityPool();
        gasPool = new GasPool();
        lusdToken = new LUSDToken(
            address(troveManager),
            address(stabilityPool),
            address(borrowerOperations),
            _governance,
            _guardian
        );

        collSurplusPool = new CollSurplusPool();
        priceFeedTestnet = new PriceFeedTestnet();

        sortedTroves = new SortedTroves();
        collaterals.push(_collateral);
        erc4626vaults.push(_erc4626vault);

        uint256[] memory MCRs = new uint256[](1);
        MCRs[0] = collateralConfig.MIN_ALLOWED_MCR();

        uint256[] memory CCRs = new uint256[](1);
        CCRs[0] = collateralConfig.MIN_ALLOWED_CCR();

        collateralConfig.initialize(collaterals, MCRs, CCRs);

        troveManager.setAddresses(address(borrowerOperations), address(collateralConfig),
            address(activePool), address(defaultPool), 
            address(stabilityPool), address(gasPool), address(collSurplusPool),
            address(priceFeedTestnet), address(lusdToken), 
            address(sortedTroves), address(0), address(0), address(redemptionHelper));
       
        borrowerOperations.setAddresses(address(collateralConfig), address(troveManager), 
            address(activePool), address(defaultPool), 
            address(stabilityPool), address(gasPool), address(collSurplusPool),
            address(priceFeedTestnet), address(sortedTroves), 
            address(lusdToken), address(0));

        activePool.setAddresses(address(collateralConfig), address(borrowerOperations),
            address(troveManager), address(stabilityPool), address(defaultPool), address(collSurplusPool),
            _treasuryAddress, address(0), erc4626vaults);

        defaultPool.setAddresses(address(collateralConfig), address(troveManager), address(activePool));
        
        stabilityPool.setAddresses(address(borrowerOperations), address(collateralConfig),
            address(troveManager), address(activePool), address(lusdToken), 
            address(sortedTroves), address(priceFeedTestnet), address(0));

        collSurplusPool.setAddresses(address(collateralConfig), address(borrowerOperations), 
             address(troveManager), address(activePool));
    
        sortedTroves.setParams(address(troveManager), address(borrowerOperations));

        for (uint i = 0; i < NUMBER_OF_ACTORS; i++) {
            echidnaProxies[i] = new EchidnaProxy(troveManager, borrowerOperations, stabilityPool, lusdToken);
            // TODO tess3rac7 will need another way of sending initial ERC20 balances
            // (bool success, ) = address(echidnaProxies[i]).call{value: INITIAL_BALANCE}("");
            // require(success);
        }

        MCR = collateralConfig.MIN_ALLOWED_MCR();
        CCR = collateralConfig.MIN_ALLOWED_CCR();
        LUSD_GAS_COMPENSATION = borrowerOperations.LUSD_GAS_COMPENSATION();
        require(MCR > 0);
        require(CCR > 0);

        // TODO:
        priceFeedTestnet.setPrice(_collateral, 1e22);
    }

    // TroveManager

    function liquidateExt(uint _i, address _user) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].liquidatePrx(_user, collaterals[0]);
    }

    function liquidateTrovesExt(uint _i, uint _n) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].liquidateTrovesPrx(collaterals[0], _n);
    }

    function batchLiquidateTrovesExt(uint _i, address[] calldata _troveArray) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].batchLiquidateTrovesPrx(collaterals[0], _troveArray);
    }

    function redeemCollateralExt(
        uint _i,
        uint _LUSDAmount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint _partialRedemptionHintNICR
    ) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].redeemCollateralPrx(collaterals[0], _LUSDAmount, _firstRedemptionHint, _upperPartialRedemptionHint, _lowerPartialRedemptionHint, _partialRedemptionHintNICR, 0, 0);
    }

    // Borrower Operations

    function getAdjustedColl(uint actorBalance, uint _collAmount, uint ratio) internal view returns (uint) {
        uint price = priceFeedTestnet.getPrice(collaterals[0]);
        require(price > 0);
        uint minColl = ratio.mul(LUSD_GAS_COMPENSATION).div(price);
        require(actorBalance > minColl);
        uint coll = minColl + _collAmount % (actorBalance - minColl);
        return coll;
    }

    function getAdjustedLUSD(uint collAmount, uint _LUSDAmount, uint ratio) internal view returns (uint) {
        uint price = priceFeedTestnet.getPrice(collaterals[0]);
        uint LUSDAmount = _LUSDAmount;
        uint compositeDebt = LUSDAmount.add(LUSD_GAS_COMPENSATION);
        uint256 collDecimals = collateralConfig.getCollateralDecimals(collaterals[0]);
        uint ICR = LiquityMath._computeCR(collAmount, compositeDebt, price, collDecimals);
        if (ICR < ratio) {
            compositeDebt = collAmount.mul(price).div(ratio);
            LUSDAmount = compositeDebt.sub(LUSD_GAS_COMPENSATION);
        }
        return LUSDAmount;
    }

    function openTroveExt(uint _i, uint _collAmount, uint _LUSDAmount) public {
        uint actor = _i % NUMBER_OF_ACTORS;
        EchidnaProxy echidnaProxy = echidnaProxies[actor];
        uint actorBalance = IERC20(collaterals[0]).balanceOf(address(echidnaProxy));

        // we pass in CCR instead of MCR in case it’s the first one
        uint collAmount = getAdjustedColl(actorBalance, _collAmount, CCR);
        uint LUSDAmount = getAdjustedLUSD(collAmount, _LUSDAmount, CCR);

        //console.log('ETH', ETH);
        //console.log('LUSDAmount', LUSDAmount);

        echidnaProxy.openTrovePrx(collaterals[0], collAmount, LUSDAmount, address(0), address(0), 0);

        numberOfTroves = troveManager.getTroveOwnersCount(collaterals[0]);
        assert(numberOfTroves > 0);
        // canary
        //assert(numberOfTroves == 0);
    }

    function openTroveRawExt(uint _i, uint _collAmount, uint _LUSDAmount, address _upperHint, address _lowerHint, uint _maxFee) public {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].openTrovePrx(collaterals[0], _collAmount, _LUSDAmount, _upperHint, _lowerHint, _maxFee);
    }

    function addCollExt(uint _i, uint _collAmount) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        EchidnaProxy echidnaProxy = echidnaProxies[actor];
        uint actorBalance = IERC20(collaterals[0]).balanceOf(address(echidnaProxy));

        uint collAmount = getAdjustedColl(actorBalance, _collAmount, MCR);

        echidnaProxy.addCollPrx(collaterals[0], collAmount, address(0), address(0));
    }

    function addCollRawExt(uint _i, uint _collAmount, address _upperHint, address _lowerHint) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].addCollPrx(collaterals[0], _collAmount, _upperHint, _lowerHint);
    }

    function withdrawCollExt(uint _i, uint _amount, address _upperHint, address _lowerHint) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].withdrawCollPrx(collaterals[0], _amount, _upperHint, _lowerHint);
    }

    function withdrawLUSDExt(uint _i, uint _amount, address _upperHint, address _lowerHint, uint _maxFee) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].withdrawLUSDPrx(collaterals[0], _amount, _upperHint, _lowerHint, _maxFee);
    }

    function repayLUSDExt(uint _i, uint _amount, address _upperHint, address _lowerHint) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].repayLUSDPrx(collaterals[0], _amount, _upperHint, _lowerHint);
    }

    function closeTroveExt(uint _i) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].closeTrovePrx(collaterals[0]);
    }

    function adjustTroveExt(uint _i, uint _collTopUp, uint _collWithdrawal, uint _debtChange, bool _isDebtIncrease) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        EchidnaProxy echidnaProxy = echidnaProxies[actor];
        uint actorBalance = IERC20(collaterals[0]).balanceOf(address(echidnaProxy));

        uint collAmount = getAdjustedColl(actorBalance, _collTopUp, MCR);
        uint debtChange = _debtChange;
        if (_isDebtIncrease) {
            // TODO: add current amount already withdrawn:
            debtChange = getAdjustedLUSD(collAmount, uint(_debtChange), MCR);
        }
        // TODO: collWithdrawal, debtChange
        echidnaProxy.adjustTrovePrx(collaterals[0], collAmount, _collWithdrawal, debtChange, _isDebtIncrease, address(0), address(0), 0);
    }

    function adjustTroveRawExt(uint _i, uint _collTopUp, uint _collWithdrawal, uint _debtChange, bool _isDebtIncrease, address _upperHint, address _lowerHint, uint _maxFee) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].adjustTrovePrx(collaterals[0], _collTopUp, _collWithdrawal, _debtChange, _isDebtIncrease, _upperHint, _lowerHint, _maxFee);
    }

    // Pool Manager

    function provideToSPExt(uint _i, uint _amount) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].provideToSPPrx(_amount);
    }

    function withdrawFromSPExt(uint _i, uint _amount) external {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].withdrawFromSPPrx(_amount);
    }

    // LUSD Token

    function transferExt(uint _i, address recipient, uint256 amount) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].transferPrx(recipient, amount);
    }

    function approveExt(uint _i, address spender, uint256 amount) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].approvePrx(spender, amount);
    }

    function transferFromExt(uint _i, address sender, address recipient, uint256 amount) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].transferFromPrx(sender, recipient, amount);
    }

    function increaseAllowanceExt(uint _i, address spender, uint256 addedValue) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].increaseAllowancePrx(spender, addedValue);
    }

    function decreaseAllowanceExt(uint _i, address spender, uint256 subtractedValue) external returns (bool) {
        uint actor = _i % NUMBER_OF_ACTORS;
        echidnaProxies[actor].decreaseAllowancePrx(spender, subtractedValue);
    }

    // PriceFeed

    function setPriceExt(uint256 _price) external {
        bool result = priceFeedTestnet.setPrice(collaterals[0], _price);
        assert(result);
    }

    // --------------------------
    // Invariants and properties
    // --------------------------

    function echidna_canary_number_of_troves() public view returns(bool) {
        if (numberOfTroves > 20) {
            return false;
        }

        return true;
    }

    function echidna_canary_active_pool_balance() public view returns(bool) {
        if (IERC20(collaterals[0]).balanceOf(address(activePool)) > 0) {
            return false;
        }
        return true;
    }

    function echidna_troves_order() external view returns(bool) {
        address currentTrove = sortedTroves.getFirst(collaterals[0]);
        address nextTrove = sortedTroves.getNext(collaterals[0], currentTrove);

        while (currentTrove != address(0) && nextTrove != address(0)) {
            if (troveManager.getNominalICR(nextTrove, collaterals[0]) > troveManager.getNominalICR(currentTrove, collaterals[0])) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            currentTrove = nextTrove;
            nextTrove = sortedTroves.getNext(collaterals[0], currentTrove);
        }

        return true;
    }

    /**
     * Status
     * Minimum debt (gas compensation)
     * Stake > 0
     */
    function echidna_trove_properties() public view returns(bool) {
        address currentTrove = sortedTroves.getFirst(collaterals[0]);
        while (currentTrove != address(0)) {
            // Status
            if (TroveManager.Status(troveManager.getTroveStatus(currentTrove, collaterals[0])) != TroveManager.Status.active) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            // Minimum debt (gas compensation)
            if (troveManager.getTroveDebt(currentTrove, collaterals[0]) < LUSD_GAS_COMPENSATION) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            // Stake > 0
            if (troveManager.getTroveStake(currentTrove, collaterals[0]) == 0) {
                return false;
            }
            // Uncomment to check that the condition is meaningful
            //else return false;

            currentTrove = sortedTroves.getNext(collaterals[0], currentTrove);
        }
        return true;
    }

    function echidna_ETH_balances() public view returns(bool) {
        if (IERC20(collaterals[0]).balanceOf(address(troveManager)) > 0) {
            return false;
        }

        if (IERC20(collaterals[0]).balanceOf(address(borrowerOperations)) > 0) {
            return false;
        }

        if (IERC20(collaterals[0]).balanceOf(address(activePool)) != activePool.getCollateral(collaterals[0])) {
            return false;
        }

        if (IERC20(collaterals[0]).balanceOf(address(defaultPool)) != defaultPool.getCollateral(collaterals[0])) {
            return false;
        }

        if (IERC20(collaterals[0]).balanceOf(address(stabilityPool)) != stabilityPool.getCollateral(collaterals[0])) {
            return false;
        }

        if (IERC20(collaterals[0]).balanceOf(address(lusdToken)) > 0) {
            return false;
        }
    
        if (IERC20(collaterals[0]).balanceOf(address(priceFeedTestnet)) > 0) {
            return false;
        }
        
        if (IERC20(collaterals[0]).balanceOf(address(sortedTroves)) > 0) {
            return false;
        }

        return true;
    }

    // TODO: What should we do with this? Should it be allowed? Should it be a canary?
    function echidna_price() public view returns(bool) {
        uint price = priceFeedTestnet.getPrice(collaterals[0]);
        
        if (price == 0) {
            return false;
        }
        // Uncomment to check that the condition is meaningful
        //else return false;

        return true;
    }

    // Total LUSD matches
    function echidna_LUSD_global_balances() public view returns(bool) {
        uint totalSupply = lusdToken.totalSupply();
        uint gasPoolBalance = lusdToken.balanceOf(address(gasPool));

        uint activePoolBalance = activePool.getLUSDDebt(collaterals[0]);
        uint defaultPoolBalance = defaultPool.getLUSDDebt(collaterals[0]);
        if (totalSupply != activePoolBalance + defaultPoolBalance) {
            return false;
        }

        uint stabilityPoolBalance = stabilityPool.getTotalLUSDDeposits();
        address currentTrove = sortedTroves.getFirst(collaterals[0]);
        uint trovesBalance;
        while (currentTrove != address(0)) {
            trovesBalance += lusdToken.balanceOf(address(currentTrove));
            currentTrove = sortedTroves.getNext(collaterals[0], currentTrove);
        }
        // we cannot state equality because tranfers are made to external addresses too
        if (totalSupply <= stabilityPoolBalance + trovesBalance + gasPoolBalance) {
            return false;
        }

        return true;
    }

    /*
    function echidna_test() public view returns(bool) {
        return true;
    }
    */
}
