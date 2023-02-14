// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "../interfaces/IVeloRouter.sol";
import "../interfaces/IVeloPair.sol";
import "../libraries/Babylonian.sol";
import "../libraries/SafeERC20Minimal.sol";

abstract contract VeloSolidMixin {
    using SafeERC20Minimal for IERC20Minimal;
    /// @dev tokenA => (tokenB => veloSwapPath config): returns best path to swap
    ///         tokenA to tokenB

    mapping(address => mapping(address => address[])) public veloSwapPath;

    /// @dev Helper function to swap {_from} to {_to} given an {_amount}.
    function _swapVelo(
        address _from,
        address _to,
        uint256 _amount,
        address _router
    ) internal {
        if (_from == _to || _amount == 0) {
            return;
        }

        uint256 output;
        bool useStable;
        IVeloRouter router = IVeloRouter(_router);
        address[] storage path = veloSwapPath[_from][_to];
        IVeloRouter.route[] memory routes = new IVeloRouter.route[](path.length - 1);
        uint256 prevRouteOutput = _amount;

        IERC20Minimal(_from)._safeIncreaseAllowance(_router, _amount);
        for (uint256 i = 0; i < routes.length; i++) {
            (output, useStable) = router.getAmountOut(prevRouteOutput, path[i], path[i + 1]);
            routes[i] = IVeloRouter.route({from: path[i], to: path[i + 1], stable: useStable});
            prevRouteOutput = output;
        }
        router.swapExactTokensForTokens(_amount, 0, routes, address(this), block.timestamp);
    }

    /// @dev Core harvest function.
    function _addLiquidityVelo(
        address _lpToken0,
        address _lpToken1,
        address _want,
        address _router
    ) internal {
        uint256 lpToken0Bal = IERC20Minimal(_lpToken0).balanceOf(address(this));
        uint256 lpToken1Bal = IERC20Minimal(_lpToken1).balanceOf(address(this));
        IERC20Minimal(_lpToken0)._safeIncreaseAllowance(_router, lpToken0Bal);
        IERC20Minimal(_lpToken1)._safeIncreaseAllowance(_router, lpToken1Bal);
        IVeloRouter(_router).addLiquidity(
            _lpToken0,
            _lpToken1,
            IVeloPair(_want).stable(),
            lpToken0Bal,
            lpToken1Bal,
            0,
            0,
            address(this),
            block.timestamp
        );
    }

    function _getSwapAmountVelo(
        IVeloPair pair,
        uint256 investmentA,
        uint256 reserveA,
        uint256 reserveB,
        address tokenA
    ) internal view returns (uint256 swapAmount) {
        uint256 halfInvestment = investmentA / 2;
        uint256 numerator = pair.getAmountOut(halfInvestment, tokenA);
        uint256 denominator = _quoteLiquidity(halfInvestment, reserveA + halfInvestment, reserveB - numerator);
        swapAmount = investmentA - Babylonian.sqrt((halfInvestment * halfInvestment * numerator) / denominator);
    }

    // Copied from Velodrome's Router since it's an internal function in there
    // given some amount of an asset and pair reserves, returns an equivalent amount of the other asset
    function _quoteLiquidity(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) internal pure returns (uint256 amountB) {
        require(amountA > 0, "Router: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "Router: INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    /// @dev Update {SwapPath} for a specified pair of tokens.
    function _updateVeloSwapPath(
        address _tokenIn,
        address _tokenOut,
        address[] calldata _path
    ) internal {
        require(
            _tokenIn != _tokenOut && _path.length >= 2 && _path[0] == _tokenIn && _path[_path.length - 1] == _tokenOut
        );
        veloSwapPath[_tokenIn][_tokenOut] = _path;
    }

    // Be sure to permission this in implementation
    function updateVeloSwapPath(
        address _tokenIn,
        address _tokenOut,
        address[] calldata _path
    ) external virtual;
}
