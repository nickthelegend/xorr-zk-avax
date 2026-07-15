// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title ConfidentialPayroll — claim-link payroll with confidential amounts + compliance.
/// @notice v2 of XORR Payroll. Individual salaries are NOT published: each slot stores only
/// an amount *commitment* `keccak256(amount, salt)`, so the split of a run is never revealed
/// on-chain as a list. The employer funds a public pool of collateral (the pool total is
/// visible, the per-person breakdown is not). Each recipient's `(amount, salt)` lives in
/// their private claim link; they reveal it only to collect their own slot.
///
/// Compliance: every slot carries an opaque `auditorCipher` — the amount encrypted to a
/// designated compliance/auditor public key (secp256k1 ECIES, off-chain). The auditor can
/// decrypt the entire run for reporting while the public sees only commitments.
///
/// Front-running-safe: the claim signature binds (this, chainId, id, slot, to, amount, salt),
/// so a mempool observer can neither redirect the payout nor alter the revealed amount.
contract ConfidentialPayroll {
    using SafeERC20 for IERC20;

    struct Slot {
        address claimAddr; // address(claimPrivKey) — the emailed claim key
        bytes32 amountCommit; // keccak256(abi.encode(amount, salt)) — hides the amount
        bool claimed;
    }

    struct Run {
        address employer;
        IERC20 token;
        uint64 createdAt;
        uint64 expiry; // 0 = permanent (no sweep)
        uint128 pool; // public collateral funded by the employer
        uint128 disbursed; // claimed + swept
        address auditor; // compliance key holder (informational; ciphers are opaque)
    }

    Run[] private _runs;
    mapping(uint256 => Slot[]) private _slots;
    mapping(uint256 => bytes[]) private _auditorCiphers; // per-slot compliance blob

    event RunCreated(
        uint256 indexed id,
        address indexed employer,
        address indexed token,
        uint256 count,
        uint256 pool,
        address auditor,
        uint64 expiry
    );
    event Claimed(uint256 indexed id, uint256 indexed slot, address indexed to);
    event Swept(uint256 indexed id, address indexed employer, uint256 amount);

    error EmptyBatch();
    error LengthMismatch();
    error ZeroPool();
    error ZeroClaimAddr();
    error BadId();
    error BadSlot();
    error AlreadyClaimed();
    error BadCommit();
    error BadSignature();
    error PoolExceeded();
    error NotEmployer();
    error NoExpiry();
    error NotExpired();
    error NothingToSweep();
    error ZeroTo();
    error BadTransferAmount();

    // ── Views ────────────────────────────────────────────────────────────────
    function runCount() external view returns (uint256) {
        return _runs.length;
    }

    function slotCount(uint256 id) external view returns (uint256) {
        _requireId(id);
        return _slots[id].length;
    }

    function getRun(uint256 id) external view returns (Run memory) {
        _requireId(id);
        return _runs[id];
    }

    function getSlot(uint256 id, uint256 slot) external view returns (Slot memory) {
        _requireId(id);
        if (slot >= _slots[id].length) revert BadSlot();
        return _slots[id][slot];
    }

    /// @notice The opaque compliance cipher for a slot — the amount encrypted to the run's
    /// auditor key. Meaningful only to the holder of the matching private key.
    function auditorCipher(uint256 id, uint256 slot) external view returns (bytes memory) {
        _requireId(id);
        if (slot >= _slots[id].length) revert BadSlot();
        return _auditorCiphers[id][slot];
    }

    function amountCommit(uint128 amount, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(amount, salt));
    }

    /// @notice What a recipient's claim key must sign (EIP-191) to release a slot.
    function claimDigest(uint256 id, uint256 slot, address to, uint128 amount, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), block.chainid, id, slot, to, amount, salt));
    }

    // ── Employer: fund a confidential run ────────────────────────────────────
    function createRun(
        IERC20 token,
        address[] calldata claimAddrs,
        bytes32[] calldata commits,
        bytes[] calldata auditorCiphers_,
        uint128 pool,
        address auditor,
        uint64 expiry
    ) external returns (uint256 id) {
        uint256 n = claimAddrs.length;
        if (n == 0) revert EmptyBatch();
        if (n != commits.length || n != auditorCiphers_.length) revert LengthMismatch();
        if (pool == 0) revert ZeroPool();

        id = _runs.length;
        _runs.push(
            Run({
                employer: msg.sender,
                token: token,
                createdAt: uint64(block.timestamp),
                expiry: expiry,
                pool: pool,
                disbursed: 0,
                auditor: auditor
            })
        );
        _store(id, claimAddrs, commits, auditorCiphers_);

        _pull(token, pool);
        emit RunCreated(id, msg.sender, address(token), n, pool, auditor, expiry);
    }

    /// Pull `amount` from the caller and verify the received balance delta exactly matches
    /// (rejects fee-on-transfer/deflationary tokens). Kept separate to bound stack depth.
    function _pull(IERC20 token, uint128 amount) private {
        uint256 pre = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - pre != amount) revert BadTransferAmount();
    }

    /// Store slots + compliance ciphers for a run (kept separate to bound stack depth).
    function _store(
        uint256 id,
        address[] calldata claimAddrs,
        bytes32[] calldata commits,
        bytes[] calldata ciphers
    ) private {
        Slot[] storage slots = _slots[id];
        bytes[] storage cs = _auditorCiphers[id];
        for (uint256 k; k < claimAddrs.length; ++k) {
            if (claimAddrs[k] == address(0)) revert ZeroClaimAddr();
            slots.push(Slot({claimAddr: claimAddrs[k], amountCommit: commits[k], claimed: false}));
            cs.push(ciphers[k]);
        }
    }

    // ── Recipient: claim (reveals amount only for their own slot) ─────────────
    function claim(uint256 id, uint256 slot, address to, uint128 amount, bytes32 salt, bytes calldata signature)
        external
    {
        if (to == address(0)) revert ZeroTo();
        _requireId(id);
        if (slot >= _slots[id].length) revert BadSlot();
        Slot storage s = _slots[id][slot];
        if (s.claimed) revert AlreadyClaimed();
        if (amountCommit(amount, salt) != s.amountCommit) revert BadCommit();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(claimDigest(id, slot, to, amount, salt));
        if (ECDSA.recover(digest, signature) != s.claimAddr) revert BadSignature();

        Run storage r = _runs[id];
        if (amount > r.pool - r.disbursed) revert PoolExceeded();
        r.disbursed += amount;
        s.claimed = true;

        r.token.safeTransfer(to, amount);
        emit Claimed(id, slot, to);
    }

    // ── Employer: sweep unclaimed collateral after expiry ─────────────────────
    function sweep(uint256 id) external {
        _requireId(id);
        Run storage r = _runs[id];
        if (msg.sender != r.employer) revert NotEmployer();
        if (r.expiry == 0) revert NoExpiry();
        if (block.timestamp < r.expiry) revert NotExpired();

        uint128 left = r.pool - r.disbursed;
        if (left == 0) revert NothingToSweep();
        r.disbursed = r.pool; // no further claims can draw down
        r.token.safeTransfer(r.employer, left);
        emit Swept(id, r.employer, left);
    }

    function _requireId(uint256 id) private view {
        if (id >= _runs.length) revert BadId();
    }
}
