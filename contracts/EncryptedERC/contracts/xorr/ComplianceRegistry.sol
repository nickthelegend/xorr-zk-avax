// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Minimal view into ConfidentialPayroll — the registry couples to its `getRun` ABI
/// so it can bind an attestation to the run's designated auditor.
interface IConfPayrollAuditor {
    function getRun(uint256)
        external
        view
        returns (
            address employer,
            address token,
            uint64 createdAt,
            uint64 expiry,
            uint128 pool,
            uint128 disbursed,
            address auditor
        );
}

/// @title ComplianceRegistry — on-chain anchor for verified confidential-payroll audits.
/// @notice A compliance officer reviews a ConfidentialPayroll run: they decrypt every slot's
/// amount and check it against the on-chain `keccak256(amount, salt)` commitment (so the
/// employer can't have lied). They then produce a `reportHash` over the verified data and
/// sign an attestation with their auditor key. This registry verifies that signature and
/// anchors the attestation — timestamped and tamper-evident — so any third party can later
/// confirm that the run was audited, by whom, and against which report, without secrets.
///
/// The auditor never needs gas: they sign off-chain and anyone (the employer, a relayer)
/// submits the signature. Trust is in `msg.sender`-independent `ecrecover(auditor)`.
contract ComplianceRegistry {
    struct Attestation {
        address auditor; // recovered from the signature — the compliance key's EVM identity
        bytes32 reportHash; // keccak of the verified report (recomputable off-chain)
        uint128 verifiedTotal; // sum of verified amounts
        uint64 timestamp; // when anchored
    }

    // (payroll contract, runId) → latest attestation
    mapping(address => mapping(uint256 => Attestation)) private _att;

    event Attested(
        address indexed payroll,
        uint256 indexed runId,
        address indexed auditor,
        bytes32 reportHash,
        uint128 verifiedTotal
    );

    error ZeroAuditor();
    error BadSignature();
    error AlreadyAttested();
    error WrongAuditor();

    /// @notice The digest an auditor signs (EIP-191) to attest a run's report.
    function attestationDigest(
        address payroll,
        uint256 runId,
        bytes32 reportHash,
        uint128 verifiedTotal,
        address auditor
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, payroll, runId, reportHash, verifiedTotal, auditor));
    }

    /// @notice Anchor a compliance attestation. Verifies `signature` recovers to `auditor`,
    /// binding the whole (payroll, runId, reportHash, verifiedTotal) tuple. Callable by anyone
    /// (the auditor's signature is the authority, not the sender).
    function attest(
        address payroll,
        uint256 runId,
        bytes32 reportHash,
        uint128 verifiedTotal,
        address auditor,
        bytes calldata signature
    ) external {
        if (auditor == address(0)) revert ZeroAuditor();
        if (_att[payroll][runId].timestamp != 0) revert AlreadyAttested();
        (, , , , , , address designated) = IConfPayrollAuditor(payroll).getRun(runId);
        if (auditor != designated) revert WrongAuditor();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            attestationDigest(payroll, runId, reportHash, verifiedTotal, auditor)
        );
        if (ECDSA.recover(digest, signature) != auditor) revert BadSignature();

        _att[payroll][runId] = Attestation({
            auditor: auditor,
            reportHash: reportHash,
            verifiedTotal: verifiedTotal,
            timestamp: uint64(block.timestamp)
        });
        emit Attested(payroll, runId, auditor, reportHash, verifiedTotal);
    }

    function getAttestation(address payroll, uint256 runId) external view returns (Attestation memory) {
        return _att[payroll][runId];
    }

    function isAttested(address payroll, uint256 runId) external view returns (bool) {
        return _att[payroll][runId].timestamp != 0;
    }
}
