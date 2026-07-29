// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";

interface VmOrganizationRegistry {
    function addr(uint256 privateKey) external returns (address);
    function expectPartialRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract OrganizationRegistryTest {
    VmOrganizationRegistry private constant vm =
        VmOrganizationRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ATTESTOR_KEY = 0xD0EBA6;
    address private constant ADMIN = address(0xA11CE);
    address private constant RECLAIM = address(0xBEEF);
    address private constant NEW_RECLAIM = address(0xCAFE);
    uint64 private constant CHANGE_DELAY = 1 days;
    string private constant DOMAIN = "refunds.example";

    OrganizationRegistry private registry;

    function setUp() external {
        registry = new OrganizationRegistry(vm.addr(ATTESTOR_KEY), CHANGE_DELAY);
    }

    function testRegistersDomainBackedOrganization() external {
        bytes32 organizationId = _register();
        OrganizationRegistry.OrganizationView memory organization =
            registry.getOrganization(organizationId);

        require(organization.admin == ADMIN, "wrong admin");
        require(organization.reclaimAddress == RECLAIM, "wrong reclaim address");
        require(organization.reclaimVersion == 1, "wrong reclaim version");
        require(organization.active, "organization inactive");
        require(
            registry.isAuthorizedIssuer(organizationId, ADMIN), "admin should be initial issuer"
        );
        require(keccak256(bytes(organization.domain)) == keccak256(bytes(DOMAIN)), "wrong domain");
    }

    function testRejectsAttestationFromUnknownSigner() external {
        bytes32 organizationId = registry.organizationIdFor(DOMAIN);
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes32 nonce = keccak256("unknown-attestor");
        OrganizationRegistry.DomainAttestation memory attestation =
            OrganizationRegistry.DomainAttestation({
                organizationId: organizationId, admin: ADMIN, validUntil: validUntil, nonce: nonce
            });
        bytes memory signature = _sign(0xBAD, registry.hashDomainAttestation(attestation));

        vm.prank(ADMIN);
        vm.expectPartialRevert(OrganizationRegistry.InvalidAttestation.selector);
        registry.registerOrganization(
            DOMAIN, "Refunds Example", RECLAIM, validUntil, nonce, signature
        );
    }

    function testRejectsExpiredAndExcessivelyLongAttestations() external {
        bytes32 organizationId = registry.organizationIdFor(DOMAIN);

        OrganizationRegistry.DomainAttestation memory expired =
            OrganizationRegistry.DomainAttestation({
                organizationId: organizationId,
                admin: ADMIN,
                validUntil: uint64(block.timestamp),
                nonce: keccak256("expired")
            });
        bytes memory expiredSignature = _sign(ATTESTOR_KEY, registry.hashDomainAttestation(expired));
        vm.prank(ADMIN);
        vm.expectPartialRevert(OrganizationRegistry.DomainVerificationExpired.selector);
        registry.registerOrganization(
            DOMAIN, "Refunds Example", RECLAIM, expired.validUntil, expired.nonce, expiredSignature
        );

        OrganizationRegistry.DomainAttestation memory excessive =
            OrganizationRegistry.DomainAttestation({
                organizationId: organizationId,
                admin: ADMIN,
                validUntil: uint64(block.timestamp + 367 days),
                nonce: keccak256("excessive")
            });
        bytes memory excessiveSignature =
            _sign(ATTESTOR_KEY, registry.hashDomainAttestation(excessive));
        vm.prank(ADMIN);
        vm.expectPartialRevert(OrganizationRegistry.DomainVerificationExpired.selector);
        registry.registerOrganization(
            DOMAIN,
            "Refunds Example",
            RECLAIM,
            excessive.validUntil,
            excessive.nonce,
            excessiveSignature
        );
    }

    function testAttestationCannotBeReplayed() external {
        bytes32 organizationId = _register();
        OrganizationRegistry.OrganizationView memory organization =
            registry.getOrganization(organizationId);
        bytes32 nonce = keccak256("renew");
        uint64 validUntil = uint64(block.timestamp + 60 days);
        OrganizationRegistry.DomainAttestation memory attestation =
            OrganizationRegistry.DomainAttestation({
                organizationId: organizationId,
                admin: organization.admin,
                validUntil: validUntil,
                nonce: nonce
            });
        bytes memory signature = _sign(ATTESTOR_KEY, registry.hashDomainAttestation(attestation));

        vm.prank(ADMIN);
        registry.renewDomainVerification(organizationId, validUntil, nonce, signature);

        vm.prank(ADMIN);
        vm.expectPartialRevert(OrganizationRegistry.AttestationAlreadyUsed.selector);
        registry.renewDomainVerification(organizationId, validUntil, nonce, signature);
    }

    function testAdminManagesIssuerAndStatus() external {
        bytes32 organizationId = _register();
        address issuer = address(0x155E);

        vm.prank(ADMIN);
        registry.setIssuer(organizationId, issuer, true);
        require(registry.isAuthorizedIssuer(organizationId, issuer), "issuer not authorized");

        vm.prank(ADMIN);
        registry.setIssuer(organizationId, issuer, false);
        require(!registry.isAuthorizedIssuer(organizationId, issuer), "issuer not revoked");

        vm.prank(ADMIN);
        registry.setActive(organizationId, false);
        require(!registry.getOrganization(organizationId).active, "organization not paused");
    }

    function testReclaimRotationIsDelayedAndVersioned() external {
        bytes32 organizationId = _register();

        vm.prank(ADMIN);
        registry.proposeReclaimAddress(organizationId, NEW_RECLAIM);
        OrganizationRegistry.OrganizationView memory pending =
            registry.getOrganization(organizationId);
        require(pending.pendingReclaimAddress == NEW_RECLAIM, "pending reclaim missing");

        vm.expectPartialRevert(OrganizationRegistry.ReclaimActivationNotReady.selector);
        registry.activateReclaimAddress(organizationId);

        vm.warp(pending.pendingReclaimActivatesAt);
        registry.activateReclaimAddress(organizationId);
        OrganizationRegistry.OrganizationView memory active =
            registry.getOrganization(organizationId);
        require(active.reclaimAddress == NEW_RECLAIM, "reclaim address not activated");
        require(active.reclaimVersion == 2, "version not incremented");
        require(active.pendingReclaimAddress == address(0), "pending reclaim not cleared");
    }

    function testOnlyAdminCanChangeOrganization() external {
        bytes32 organizationId = _register();

        vm.prank(address(0xBAD));
        vm.expectPartialRevert(OrganizationRegistry.Unauthorized.selector);
        registry.proposeReclaimAddress(organizationId, NEW_RECLAIM);
    }

    function _register() private returns (bytes32 organizationId) {
        organizationId = registry.organizationIdFor(DOMAIN);
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes32 nonce = keccak256("registration");
        OrganizationRegistry.DomainAttestation memory attestation =
            OrganizationRegistry.DomainAttestation({
                organizationId: organizationId, admin: ADMIN, validUntil: validUntil, nonce: nonce
            });
        bytes memory signature = _sign(ATTESTOR_KEY, registry.hashDomainAttestation(attestation));

        vm.prank(ADMIN);
        registry.registerOrganization(
            DOMAIN, "Refunds Example", RECLAIM, validUntil, nonce, signature
        );
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

