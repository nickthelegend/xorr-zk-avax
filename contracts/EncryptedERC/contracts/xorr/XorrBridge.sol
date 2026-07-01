// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title XorrBridge — source-side escrow for the EVM → Avalanche eERC bridge.
/// @notice Lock-and-mint corridor between two EVM chains:
///   • Bridge IN:  a user `lock`s an ERC-20 here on the source chain; a relayer
///     observes the `Locked` event and `privateMint`s the confidential xUSD
///     equivalent on the destination eERC (Avalanche Fuji). There is no
///     on-chain link between the public lock and the encrypted mint.
///   • Bridge OUT: the user burns confidential xUSD on the eERC; the relayer
///     `release`s the locked ERC-20 back to them here, using the burn's
///     nullifier so a release can never be replayed.
/// The relayer is the trusted operator (same key as the eERC owner in the demo).
contract XorrBridge {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public relayer;
    uint256 public nonce;
    uint256 public totalLocked;

    /// nullifiers already released (bridge-out replay protection)
    mapping(bytes32 => bool) public released;

    event Locked(
        uint256 indexed id,
        address indexed from,
        address fujiRecipient,
        uint256 amount
    );
    event Released(bytes32 indexed nullifier, address indexed to, uint256 amount);
    event RelayerChanged(address indexed relayer);

    error NotRelayer();
    error AlreadyReleased();
    error ZeroAmount();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(IERC20 _token, address _relayer) {
        token = _token;
        relayer = _relayer;
    }

    /// @notice Lock `amount` of the bridged token to mint private xUSD to
    /// `fujiRecipient` on the destination eERC. `fujiRecipient` must be an
    /// eERC-registered address on Avalanche.
    /// @return id the lock nonce, echoed in the `Locked` event for the relayer.
    function lock(uint256 amount, address fujiRecipient) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        unchecked {
            id = ++nonce;
            totalLocked += amount;
        }
        emit Locked(id, msg.sender, fujiRecipient, amount);
    }

    /// @notice Relayer releases locked funds for a bridge-out after the user has
    /// burned the equivalent confidential xUSD on the eERC. `nullifier` binds to
    /// that burn so the release is single-use.
    function release(address to, uint256 amount, bytes32 nullifier) external onlyRelayer {
        if (amount == 0) revert ZeroAmount();
        if (released[nullifier]) revert AlreadyReleased();
        released[nullifier] = true;
        totalLocked -= amount;
        token.safeTransfer(to, amount);
        emit Released(nullifier, to, amount);
    }

    function setRelayer(address r) external onlyRelayer {
        relayer = r;
        emit RelayerChanged(r);
    }
}
