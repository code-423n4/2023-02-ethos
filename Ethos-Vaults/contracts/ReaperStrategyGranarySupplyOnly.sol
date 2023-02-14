// SPDX-License-Identifier: BUSL1.1

pragma solidity ^0.8.0;

import "./abstract/ReaperBaseStrategyv4.sol";
import "./interfaces/IAToken.sol";
import "./interfaces/IAaveProtocolDataProvider.sol";
import "./interfaces/ILendingPool.sol";
import "./interfaces/ILendingPoolAddressesProvider.sol";
import "./interfaces/IRewardsController.sol";
import "./libraries/ReaperMathUtils.sol";
import "./mixins/VeloSolidMixin.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

/**
 * @dev This strategy will deposit a token on Granary to maximize yield
 */
contract ReaperStrategyGranarySupplyOnly is ReaperBaseStrategyv4, VeloSolidMixin {
    using ReaperMathUtils for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // 3rd-party contract addresses
    address public constant VELO_ROUTER = 0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9;
    ILendingPoolAddressesProvider public constant ADDRESSES_PROVIDER =
        ILendingPoolAddressesProvider(0xdDE5dC81e40799750B92079723Da2acAF9e1C6D6);
    IAaveProtocolDataProvider public constant DATA_PROVIDER =
        IAaveProtocolDataProvider(0x9546F673eF71Ff666ae66d01Fd6E7C6Dae5a9995);
    IRewardsController public constant REWARDER = IRewardsController(0x6A0406B8103Ec68EE9A713A073C7bD587c5e04aD);

    // this strategy's configurable tokens
    IAToken public gWant;

    // Misc constants
    uint16 private constant LENDER_REFERRAL_CODE_NONE = 0;

    /**
     * @dev Tokens Used:
     * {rewardClaimingTokens} - Array containing gWant, used for claiming rewards
     */
    address[] public rewardClaimingTokens;

    /**
     * We break down the harvest logic into the following operations:
     * 1. Claiming rewards
     * 2. A series of swaps as required
     * 3. Creating more of the strategy's underlying token, if necessary.
     *
     * #1 and #3 are specific to each protocol.
     * #2 however is mostly the same across all strats. So to make things more generic, we
     * will execute #2 by iterating through a series of pre-defined "steps".
     *
     * This array holds all the swapping operations in sequence.
     * {ADMIN} role or higher will be able to set this array.
     */
    address[2][] public steps;

    /**
     * @dev Initializes the strategy. Sets parameters, saves routes, and gives allowances.
     * @notice see documentation for each variable above its respective declaration.
     */
    function initialize(
        address _vault,
        address[] memory _strategists,
        address[] memory _multisigRoles,
        IAToken _gWant
    ) public initializer {
        gWant = _gWant;
        want = _gWant.UNDERLYING_ASSET_ADDRESS();
        __ReaperBaseStrategy_init(_vault, want, _strategists, _multisigRoles);
        rewardClaimingTokens = [address(_gWant)];
    }

    function _adjustPosition(uint256 _debt) internal override {
        if (emergencyExit) {
            return;
        }

        uint256 wantBalance = balanceOfWant();
        if (wantBalance > _debt) {
            uint256 toReinvest = wantBalance - _debt;
            _deposit(toReinvest);
        }
    }

    function _liquidatePosition(uint256 _amountNeeded)
        internal
        override
        returns (uint256 liquidatedAmount, uint256 loss)
    {
        uint256 wantBal = balanceOfWant();
        if (wantBal < _amountNeeded) {
            _withdraw(_amountNeeded - wantBal);
            liquidatedAmount = balanceOfWant();
        } else {
            liquidatedAmount = _amountNeeded;
        }

        if (_amountNeeded > liquidatedAmount) {
            loss = _amountNeeded - liquidatedAmount;
        }
    }

    function _liquidateAllPositions() internal override returns (uint256 amountFreed) {
        _withdrawUnderlying(balanceOfPool());
        return balanceOfWant();
    }

    /**
     * @dev Core function of the strat, in charge of collecting and swapping rewards
     *      to produce more want.
     * @notice Assumes the deposit will take care of resupplying excess want.
     */
    function _harvestCore(uint256 _debt) internal override returns (int256 roi, uint256 repayment) {
        _claimRewards();
        uint256 numSteps = steps.length;
        for (uint256 i = 0; i < numSteps; i = i.uncheckedInc()) {
            address[2] storage step = steps[i];
            IERC20Upgradeable startToken = IERC20Upgradeable(step[0]);
            uint256 amount = startToken.balanceOf(address(this));
            if (amount == 0) {
                continue;
            }
            _swapVelo(step[0], step[1], amount, VELO_ROUTER);
        }

        uint256 allocated = IVault(vault).strategies(address(this)).allocated;
        uint256 totalAssets = balanceOf();
        uint256 toFree = _debt;

        if (totalAssets > allocated) {
            uint256 profit = totalAssets - allocated;
            toFree += profit;
            roi = int256(profit);
        } else if (totalAssets < allocated) {
            roi = -int256(allocated - totalAssets);
        }

        (uint256 amountFreed, uint256 loss) = _liquidatePosition(toFree);
        repayment = MathUpgradeable.min(_debt, amountFreed);
        roi -= int256(loss);
    }

    /**
     * Only {STRATEGIST} or higher roles may update the swap path for a token.
     */
    function updateVeloSwapPath(
        address _tokenIn,
        address _tokenOut,
        address[] calldata _path
    ) external override {
        _atLeastRole(STRATEGIST);
        _updateVeloSwapPath(_tokenIn, _tokenOut, _path);
    }

    /**
     * Only {ADMIN} or higher roles may set the array
     * of steps executed as part of harvest.
     */
    function setHarvestSteps(address[2][] calldata _newSteps) external {
        _atLeastRole(ADMIN);
        delete steps;

        uint256 numSteps = _newSteps.length;
        for (uint256 i = 0; i < numSteps; i = i.uncheckedInc()) {
            address[2] memory step = _newSteps[i];
            require(step[0] != address(0));
            require(step[1] != address(0));
            steps.push(step);
        }
    }

    /**
     * @dev Function that puts the funds to work.
     */
    function _deposit(uint256 toReinvest) internal {
        if (toReinvest != 0) {
            address lendingPoolAddress = ADDRESSES_PROVIDER.getLendingPool();
            IERC20Upgradeable(want).safeIncreaseAllowance(lendingPoolAddress, toReinvest);
            ILendingPool(lendingPoolAddress).deposit(want, toReinvest, address(this), LENDER_REFERRAL_CODE_NONE);
        }
    }

    /**
     * @dev Withdraws funds from external contracts and brings them back to this contract.
     */
    function _withdraw(uint256 _amount) internal {
        if (_amount != 0) {
            _withdrawUnderlying(_amount);
        }
    }

    /**
     * @dev Attempts to Withdraw {_withdrawAmount} from pool. Withdraws max amount that can be
     *      safely withdrawn if {_withdrawAmount} is too high.
     */
    function _withdrawUnderlying(uint256 _withdrawAmount) internal {
        uint256 withdrawable = balanceOfPool();
        _withdrawAmount = MathUpgradeable.min(_withdrawAmount, withdrawable);
        ILendingPool(ADDRESSES_PROVIDER.getLendingPool()).withdraw(address(want), _withdrawAmount, address(this));
    }

    /**
     * @dev Claim rewards for supply.
     */
    function _claimRewards() internal {
        IRewardsController(REWARDER).claimAllRewardsToSelf(rewardClaimingTokens);
    }

    /**
     * @dev Attempts to safely withdraw {_amount} from the pool.
     */
    function authorizedWithdrawUnderlying(uint256 _amount) external {
        _atLeastRole(STRATEGIST);
        _withdrawUnderlying(_amount);
    }

    /**
     * @dev Function to calculate the total {want} held by the strat.
     * It takes into account both the funds in hand, plus the funds in the lendingPool.
     */
    function balanceOf() public view override returns (uint256) {
        return balanceOfPool() + balanceOfWant();
    }

    function balanceOfWant() public view returns (uint256) {
        return IERC20Upgradeable(want).balanceOf(address(this));
    }

    function balanceOfPool() public view returns (uint256) {
        (uint256 supply, , , , , , , , ) = IAaveProtocolDataProvider(DATA_PROVIDER).getUserReserveData(
            address(want),
            address(this)
        );
        return supply;
    }
}
