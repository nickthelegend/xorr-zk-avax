// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title XorrAMM — minimal constant-product AMM (x*y=k) with a 0.30% fee.
/// @notice The public swap venue for XORR. A *confidential* swap composes this
/// with the eERC: the user burns confidential xUSD, the relayer releases the
/// public equivalent and swaps it here, sending the output token to a fresh
/// address — so the trade has no on-chain link to the user's identity or balance.
contract XorrAMM {
    using SafeERC20 for IERC20;

    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    uint256 public reserveA;
    uint256 public reserveB;

    uint256 private constant FEE_NUM = 997; // 0.3% fee
    uint256 private constant FEE_DEN = 1000;

    event LiquidityAdded(address indexed from, uint256 amountA, uint256 amountB);
    event Swap(address indexed to, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    error BadToken();
    error Slippage();
    error ZeroAmount();

    constructor(IERC20 _tokenA, IERC20 _tokenB) {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external {
        if (amountA == 0 || amountB == 0) revert ZeroAmount();
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    /// Constant-product quote with fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        if (amountIn == 0) return 0;
        uint256 amountInWithFee = amountIn * FEE_NUM;
        return (amountInWithFee * reserveOut) / (reserveIn * FEE_DEN + amountInWithFee);
    }

    /// Quote for the current reserves given an input token.
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256) {
        if (tokenIn == address(tokenA)) return getAmountOut(amountIn, reserveA, reserveB);
        if (tokenIn == address(tokenB)) return getAmountOut(amountIn, reserveB, reserveA);
        revert BadToken();
    }

    /// Swap `amountIn` of `tokenIn` for the other token, sending output to `to`.
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        bool aToB = tokenIn == address(tokenA);
        if (!aToB && tokenIn != address(tokenB)) revert BadToken();

        (IERC20 tin, IERC20 tout, uint256 rin, uint256 rout) = aToB
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        tin.safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = getAmountOut(amountIn, rin, rout);
        if (amountOut < minOut) revert Slippage();

        if (aToB) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }
        tout.safeTransfer(to, amountOut);
        emit Swap(to, tokenIn, amountIn, amountOut);
    }
}
