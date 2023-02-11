// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "./Dependencies/CheckContract.sol";
import "./Dependencies/Ownable.sol";
import "./Dependencies/SafeERC20.sol";
import "./Interfaces/ICollateralConfig.sol";

/**
 * Houses whitelist of allowed collaterals (ERC20s) for the entire system. Also provides access to collateral-specific
 * properties such as decimals, MCR, and CCR. Allowed collaterals and their properties may only be set once
 * during initialization after which they are immutable.
 */
contract CollateralConfig is ICollateralConfig, CheckContract, Ownable {
    using SafeERC20 for IERC20;

    bool public initialized = false;

    // Smallest allowed value for the minimum collateral ratio for individual troves in each market (collateral)
    uint256 constant public MIN_ALLOWED_MCR = 1.1 ether; // 110%

    // Smallest allowed value for Critical system collateral ratio.
    // If a market's (collateral's) total collateral ratio (TCR) falls below the CCR, Recovery Mode is triggered.
    uint256 constant public MIN_ALLOWED_CCR = 1.5 ether; // 150%

    struct Config {
        bool allowed;
        uint256 decimals;
        uint256 MCR;
        uint256 CCR;
    }

    address[] public collaterals; // for returning entire list of allowed collaterals
    mapping (address => Config) public collateralConfig; // for O(1) checking of collateral's validity and properties

    event CollateralWhitelisted(address _collateral, uint256 _decimals, uint256 _MCR, uint256 _CCR);
    event CollateralRatiosUpdated(address _collateral, uint256 _MCR, uint256 _CCR);

    /**
     * @notice One-time owner-only initializer.
     * @param _collaterals Ordered list of ERC20 tokens that will be allowed as collateral throughout the system.
     * @param _MCRs Ordered list of minimum collateralization ratio (MCR) for each of the collaterals.
     * @param _CCRs Ordered list of critical collateralization ratio (CCR) for each of the collaterals.
     */
    function initialize(
        address[] calldata _collaterals,
        uint256[] calldata _MCRs,
        uint256[] calldata _CCRs
    ) external override onlyOwner {
        require(!initialized, "Can only initialize once");
        require(_collaterals.length != 0, "At least one collateral required");
        require(_MCRs.length == _collaterals.length, "Array lengths must match");
        require(_CCRs.length == _collaterals.length, "Array lenghts must match");
        
        for(uint256 i = 0; i < _collaterals.length; i++) {
            address collateral = _collaterals[i];
            checkContract(collateral);
            collaterals.push(collateral);

            Config storage config = collateralConfig[collateral];
            config.allowed = true;
            uint256 decimals = IERC20(collateral).decimals();
            config.decimals = decimals;

            require(_MCRs[i] >= MIN_ALLOWED_MCR, "MCR below allowed minimum");
            config.MCR = _MCRs[i];

            require(_CCRs[i] >= MIN_ALLOWED_CCR, "CCR below allowed minimum");
            config.CCR = _CCRs[i];

            emit CollateralWhitelisted(collateral, decimals, _MCRs[i], _CCRs[i]);
        }

        initialized = true;
    }

    // Admin function to lower the collateralization requirements for a particular collateral.
    // Can only lower, not increase.
    //
    // !!!PLEASE USE EXTREME CARE AND CAUTION. THIS IS IRREVERSIBLE!!!
    //
    // You probably don't want to do this unless a specific asset has proved itself through tough times.
    // Doing this irresponsibly can permanently harm the protocol.
    function updateCollateralRatios(
        address _collateral,
        uint256 _MCR,
        uint256 _CCR
    ) external onlyOwner checkCollateral(_collateral) {
        Config storage config = collateralConfig[_collateral];
        require(_MCR <= config.MCR, "Can only walk down the MCR");
        require(_CCR <= config.CCR, "Can only walk down the CCR");

        require(_MCR >= MIN_ALLOWED_MCR, "MCR below allowed minimum");
        config.MCR = _MCR;

        require(_CCR >= MIN_ALLOWED_CCR, "CCR below allowed minimum");
        config.CCR = _CCR;
        emit CollateralRatiosUpdated(_collateral, _MCR, _CCR);
    }

    function getAllowedCollaterals() external override view returns (address[] memory) {
        return collaterals;
    }

    function isCollateralAllowed(address _collateral) external override view returns (bool) {
        return collateralConfig[_collateral].allowed;
    }

    function getCollateralDecimals(
        address _collateral
    ) external override view checkCollateral(_collateral) returns (uint256) {
        return collateralConfig[_collateral].decimals;
    }

    function getCollateralMCR(
        address _collateral
    ) external override view checkCollateral(_collateral) returns (uint256) {
        return collateralConfig[_collateral].MCR;
    }

    function getCollateralCCR(
        address _collateral
    ) external override view checkCollateral(_collateral) returns (uint256) {
        return collateralConfig[_collateral].CCR;
    }

    modifier checkCollateral(address _collateral) {
        require(collateralConfig[_collateral].allowed, "Invalid collateral address");
        _;
    }
}
