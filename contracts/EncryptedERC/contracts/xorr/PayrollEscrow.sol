// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title PayrollEscrow — claim-link batch payroll for XORR.
/// @notice An employer escrows a batch of payments in one call. Each recipient is
/// represented on-chain only by a fresh, throwaway *claim address*; the matching claim
/// private key is delivered to them off-chain (an email link). To collect, the recipient
/// signs their chosen payout address with the claim key and the contract releases the funds.
///
/// Design goals:
///   • No recipient wallet required up front — pay an email, they claim into any address.
///   • Private — the employee ↔ email ↔ amount mapping never touches the chain; only
///     ephemeral, unlinkable claim addresses and amounts are stored.
///   • Front-running-safe — the claim signature commits to (this, chainId, id, slot, to),
///     so a mempool observer can neither redirect the payout nor forge a new claim.
///   • Recoverable — after `expiry`, the employer can reclaim any still-unclaimed slots.
contract PayrollEscrow {
    using SafeERC20 for IERC20;

    struct Slot {
        address claimAddr; // address(claimPrivKey) — the emailed claim key's public address
        uint128 amount;
        bool claimed;
    }

    struct Payroll {
        address employer;
        IERC20 token;
        uint64 createdAt;
        uint64 expiry; // 0 = no expiry (never reclaimable)
        uint256 unclaimed; // running total of funds still escrowed for this batch
    }

    Payroll[] private _payrolls;
    mapping(uint256 => Slot[]) private _slots;

    event PayrollCreated(
        uint256 indexed id,
        address indexed employer,
        address indexed token,
        uint256 count,
        uint256 total,
        uint64 expiry
    );
    event Claimed(uint256 indexed id, uint256 indexed slot, address indexed to, uint256 amount);
    event Reclaimed(uint256 indexed id, uint256 indexed slot, address indexed employer, uint256 amount);

    error EmptyBatch();
    error LengthMismatch();
    error ZeroAmount();
    error ZeroClaimAddr();
    error BadId();
    error BadSlot();
    error AlreadyClaimed();
    error BadSignature();
    error NotEmployer();
    error NotExpired();
    error NoExpiry();
    error ZeroTo();
    error BadTransferAmount();

    // ── Views ────────────────────────────────────────────────────────────────
    function payrollCount() external view returns (uint256) {
        return _payrolls.length;
    }

    function slotCount(uint256 id) external view returns (uint256) {
        _requireId(id);
        return _slots[id].length;
    }

    function getPayroll(uint256 id) external view returns (Payroll memory) {
        _requireId(id);
        return _payrolls[id];
    }

    function getSlot(uint256 id, uint256 slot) external view returns (Slot memory) {
        _requireId(id);
        if (slot >= _slots[id].length) revert BadSlot();
        return _slots[id][slot];
    }

    /// @notice The 32-byte digest a recipient's claim key must sign (as an EIP-191
    /// personal_sign message) to release `slot` of payroll `id` to `to`. Binding all of
    /// (this, chainId, id, slot, to) makes the signature single-use and un-redirectable.
    function claimDigest(uint256 id, uint256 slot, address to) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, id, slot, to));
    }

    // ── Employer: fund a batch ───────────────────────────────────────────────
    /// @notice Escrow `amounts` of `token` against `claimAddrs`. Pulls the full total from
    /// the caller (requires prior ERC-20 approval). Set `expiry` to a future timestamp to
    /// allow reclaiming unclaimed slots later, or 0 to make the escrow permanent.
    function createPayroll(
        IERC20 token,
        address[] calldata claimAddrs,
        uint128[] calldata amounts,
        uint64 expiry
    ) external returns (uint256 id) {
        uint256 n = claimAddrs.length;
        if (n == 0) revert EmptyBatch();
        if (n != amounts.length) revert LengthMismatch();

        id = _payrolls.length;
        Slot[] storage slots = _slots[id];
        uint256 total;
        for (uint256 k; k < n; ++k) {
            if (amounts[k] == 0) revert ZeroAmount();
            if (claimAddrs[k] == address(0)) revert ZeroClaimAddr();
            slots.push(Slot({claimAddr: claimAddrs[k], amount: amounts[k], claimed: false}));
            total += amounts[k];
        }

        _payrolls.push(
            Payroll({
                employer: msg.sender,
                token: token,
                createdAt: uint64(block.timestamp),
                expiry: expiry,
                unclaimed: total
            })
        );

        uint256 pre = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        if (token.balanceOf(address(this)) - pre != total) revert BadTransferAmount();
        emit PayrollCreated(id, msg.sender, address(token), n, total, expiry);
    }

    // ── Recipient: claim ─────────────────────────────────────────────────────
    /// @notice Collect `slot` of payroll `id` to `to`, proving ownership of the emailed
    /// claim key via `signature` over `claimDigest(id, slot, to)`.
    function claim(uint256 id, uint256 slot, address to, bytes calldata signature) external {
        if (to == address(0)) revert ZeroTo();
        _requireId(id);
        if (slot >= _slots[id].length) revert BadSlot();
        Slot storage s = _slots[id][slot];
        if (s.claimed) revert AlreadyClaimed();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(claimDigest(id, slot, to));
        if (ECDSA.recover(digest, signature) != s.claimAddr) revert BadSignature();

        s.claimed = true;
        Payroll storage p = _payrolls[id];
        uint256 amount = s.amount;
        p.unclaimed -= amount;
        p.token.safeTransfer(to, amount);
        emit Claimed(id, slot, to, amount);
    }

    // ── Employer: reclaim after expiry ───────────────────────────────────────
    /// @notice Recover an unclaimed slot back to the employer once the batch has expired.
    function reclaim(uint256 id, uint256 slot) external {
        _requireId(id);
        if (slot >= _slots[id].length) revert BadSlot();
        Payroll storage p = _payrolls[id];
        if (msg.sender != p.employer) revert NotEmployer();
        if (p.expiry == 0) revert NoExpiry();
        if (block.timestamp < p.expiry) revert NotExpired();

        Slot storage s = _slots[id][slot];
        if (s.claimed) revert AlreadyClaimed();
        s.claimed = true;
        uint256 amount = s.amount;
        p.unclaimed -= amount;
        p.token.safeTransfer(p.employer, amount);
        emit Reclaimed(id, slot, p.employer, amount);
    }

    function _requireId(uint256 id) private view {
        if (id >= _payrolls.length) revert BadId();
    }
}
