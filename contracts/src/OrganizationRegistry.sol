// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {SignatureChecker} from "./SignatureChecker.sol";

contract OrganizationRegistry {
    struct OrganizationView {
        address admin;
        address reclaimAddress;
        address pendingReclaimAddress;
        uint64 pendingReclaimActivatesAt;
        uint64 domainVerifiedUntil;
        uint32 reclaimVersion;
        bool active;
        string domain;
        string displayName;
    }

    struct DomainAttestation {
        bytes32 organizationId;
        address admin;
        uint64 validUntil;
        bytes32 nonce;
    }

    error AttestationAlreadyUsed(bytes32 digest);
    error DomainVerificationExpired(uint64 validUntil);
    error InvalidAttestation();
    error InvalidOrganizationData();
    error IssuerRequired();
    error OrganizationAlreadyExists(bytes32 organizationId);
    error OrganizationNotFound(bytes32 organizationId);
    error ReclaimActivationNotReady(uint64 activatesAt);
    error ReclaimChangeNotFound();
    error Unauthorized(address actor);

    event OrganizationRegistered(
        bytes32 indexed organizationId,
        address indexed admin,
        address indexed reclaimAddress,
        string domain,
        string displayName,
        uint64 domainVerifiedUntil
    );
    event DomainVerificationRenewed(bytes32 indexed organizationId, uint64 validUntil);
    event IssuerAuthorizationChanged(
        bytes32 indexed organizationId, address indexed issuer, bool authorized
    );
    event OrganizationStatusChanged(bytes32 indexed organizationId, bool active);
    event ReclaimChangeProposed(
        bytes32 indexed organizationId, address indexed reclaimAddress, uint64 activatesAt
    );
    event ReclaimChangeCancelled(bytes32 indexed organizationId, address indexed reclaimAddress);
    event ReclaimAddressChanged(
        bytes32 indexed organizationId, address indexed reclaimAddress, uint32 reclaimVersion
    );

    bytes32 public constant DOMAIN_ATTESTATION_TYPEHASH = keccak256(
        "DomainAttestation(bytes32 organizationId,address admin,uint64 validUntil,bytes32 nonce)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("DueBack Organization Registry");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint64 public constant MAX_DOMAIN_VERIFICATION_PERIOD = 366 days;

    address public immutable domainAttestor;
    uint64 public immutable reclaimChangeDelay;

    mapping(bytes32 organizationId => OrganizationView organization) private organizations;
    mapping(bytes32 organizationId => mapping(address issuer => bool authorized)) private issuers;
    mapping(bytes32 digest => bool used) public usedAttestations;

    constructor(address domainAttestor_, uint64 reclaimChangeDelay_) {
        if (domainAttestor_ == address(0) || reclaimChangeDelay_ == 0) {
            revert InvalidOrganizationData();
        }
        domainAttestor = domainAttestor_;
        reclaimChangeDelay = reclaimChangeDelay_;
    }

    function registerOrganization(
        string calldata domain,
        string calldata displayName,
        address reclaimAddress,
        uint64 domainVerifiedUntil,
        bytes32 nonce,
        bytes calldata attestationSignature
    ) external returns (bytes32 organizationId) {
        if (
            bytes(domain).length < 3 || bytes(domain).length > 253 || bytes(displayName).length == 0
                || bytes(displayName).length > 96 || reclaimAddress == address(0)
                || nonce == bytes32(0)
        ) revert InvalidOrganizationData();

        organizationId = organizationIdFor(domain);
        if (organizations[organizationId].admin != address(0)) {
            revert OrganizationAlreadyExists(organizationId);
        }

        DomainAttestation memory attestation = DomainAttestation({
            organizationId: organizationId,
            admin: msg.sender,
            validUntil: domainVerifiedUntil,
            nonce: nonce
        });
        _consumeAttestation(attestation, attestationSignature);

        organizations[organizationId] = OrganizationView({
            admin: msg.sender,
            reclaimAddress: reclaimAddress,
            pendingReclaimAddress: address(0),
            pendingReclaimActivatesAt: 0,
            domainVerifiedUntil: domainVerifiedUntil,
            reclaimVersion: 1,
            active: true,
            domain: domain,
            displayName: displayName
        });
        issuers[organizationId][msg.sender] = true;

        emit OrganizationRegistered(
            organizationId, msg.sender, reclaimAddress, domain, displayName, domainVerifiedUntil
        );
        emit IssuerAuthorizationChanged(organizationId, msg.sender, true);
    }

    function renewDomainVerification(
        bytes32 organizationId,
        uint64 domainVerifiedUntil,
        bytes32 nonce,
        bytes calldata attestationSignature
    ) external {
        OrganizationView storage organization = _requireAdmin(organizationId);
        DomainAttestation memory attestation = DomainAttestation({
            organizationId: organizationId,
            admin: organization.admin,
            validUntil: domainVerifiedUntil,
            nonce: nonce
        });
        _consumeAttestation(attestation, attestationSignature);
        organization.domainVerifiedUntil = domainVerifiedUntil;
        emit DomainVerificationRenewed(organizationId, domainVerifiedUntil);
    }

    function setIssuer(bytes32 organizationId, address issuer, bool authorized) external {
        OrganizationView storage organization = _requireAdmin(organizationId);
        if (issuer == address(0) || (issuer == organization.admin && !authorized)) {
            revert IssuerRequired();
        }
        issuers[organizationId][issuer] = authorized;
        emit IssuerAuthorizationChanged(organizationId, issuer, authorized);
    }

    function setActive(bytes32 organizationId, bool active) external {
        OrganizationView storage organization = _requireAdmin(organizationId);
        organization.active = active;
        emit OrganizationStatusChanged(organizationId, active);
    }

    function proposeReclaimAddress(bytes32 organizationId, address reclaimAddress) external {
        OrganizationView storage organization = _requireAdmin(organizationId);
        if (reclaimAddress == address(0) || reclaimAddress == organization.reclaimAddress) {
            revert InvalidOrganizationData();
        }
        uint64 activatesAt = uint64(block.timestamp) + reclaimChangeDelay;
        organization.pendingReclaimAddress = reclaimAddress;
        organization.pendingReclaimActivatesAt = activatesAt;
        emit ReclaimChangeProposed(organizationId, reclaimAddress, activatesAt);
    }

    function cancelReclaimAddressChange(bytes32 organizationId) external {
        OrganizationView storage organization = _requireAdmin(organizationId);
        address pending = organization.pendingReclaimAddress;
        if (pending == address(0)) revert ReclaimChangeNotFound();
        organization.pendingReclaimAddress = address(0);
        organization.pendingReclaimActivatesAt = 0;
        emit ReclaimChangeCancelled(organizationId, pending);
    }

    function activateReclaimAddress(bytes32 organizationId) external {
        OrganizationView storage organization = _requireOrganization(organizationId);
        address pending = organization.pendingReclaimAddress;
        if (pending == address(0)) revert ReclaimChangeNotFound();
        if (block.timestamp < organization.pendingReclaimActivatesAt) {
            revert ReclaimActivationNotReady(organization.pendingReclaimActivatesAt);
        }

        organization.reclaimAddress = pending;
        organization.pendingReclaimAddress = address(0);
        organization.pendingReclaimActivatesAt = 0;
        organization.reclaimVersion += 1;
        emit ReclaimAddressChanged(organizationId, pending, organization.reclaimVersion);
    }

    function getOrganization(bytes32 organizationId)
        external
        view
        returns (OrganizationView memory)
    {
        return _requireOrganization(organizationId);
    }

    function isAuthorizedIssuer(bytes32 organizationId, address issuer)
        external
        view
        returns (bool)
    {
        if (organizations[organizationId].admin == address(0)) {
            revert OrganizationNotFound(organizationId);
        }
        return issuers[organizationId][issuer];
    }

    function organizationIdFor(string memory domain) public pure returns (bytes32) {
        return keccak256(bytes(domain));
    }

    function hashDomainAttestation(DomainAttestation memory attestation)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                DOMAIN_ATTESTATION_TYPEHASH,
                attestation.organizationId,
                attestation.admin,
                attestation.validUntil,
                attestation.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _consumeAttestation(
        DomainAttestation memory attestation,
        bytes calldata attestationSignature
    ) private {
        if (
            attestation.validUntil <= block.timestamp
                || attestation.validUntil > block.timestamp + MAX_DOMAIN_VERIFICATION_PERIOD
        ) {
            revert DomainVerificationExpired(attestation.validUntil);
        }
        bytes32 digest = hashDomainAttestation(attestation);
        if (usedAttestations[digest]) revert AttestationAlreadyUsed(digest);
        if (!SignatureChecker.isValidSignatureNow(domainAttestor, digest, attestationSignature)) {
            revert InvalidAttestation();
        }
        usedAttestations[digest] = true;
    }

    function _requireAdmin(bytes32 organizationId)
        private
        view
        returns (OrganizationView storage organization)
    {
        organization = _requireOrganization(organizationId);
        if (organization.admin != msg.sender) revert Unauthorized(msg.sender);
    }

    function _requireOrganization(bytes32 organizationId)
        private
        view
        returns (OrganizationView storage organization)
    {
        organization = organizations[organizationId];
        if (organization.admin == address(0)) revert OrganizationNotFound(organizationId);
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
            )
        );
    }
}

