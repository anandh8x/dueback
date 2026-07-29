// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {DueBackCampaigns} from "../src/DueBackCampaigns.sol";
import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";

interface VmDueBackCampaigns {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 balance) external;
    function expectPartialRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract DueBackCampaignsTest {
    VmDueBackCampaigns private constant vm =
        VmDueBackCampaigns(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ATTESTOR_KEY = 0xD0EBA6;
    address private constant ADMIN = address(0xA11CE);
    address private constant ISSUER = address(0x155E);
    address private constant RECIPIENT_A = address(0xA0);
    address private constant RECIPIENT_B = address(0xB0);
    address private constant RECLAIM = address(0xBEEF);
    address private constant NEW_RECLAIM = address(0xCAFE);
    uint256 private constant AMOUNT_A = 4 ether;
    uint256 private constant AMOUNT_B = 6 ether;
    bytes32 private constant CLAIM_A = keccak256("claim-a");
    bytes32 private constant CLAIM_B = keccak256("claim-b");
    bytes32 private constant SECRET_A = keccak256("secret-a");
    bytes32 private constant SECRET_B = keccak256("secret-b");
    bytes32 private constant REFERENCE = keccak256("campaign-2026-001");

    OrganizationRegistry private registry;
    DueBackCampaigns private dueBack;
    bytes32 private organizationId;
    bytes32 private campaignId;
    bytes32 private leafA;
    bytes32 private leafB;
    bytes32 private root;

    receive() external payable {}

    function setUp() external {
        registry = new OrganizationRegistry(vm.addr(ATTESTOR_KEY), 1 days);
        dueBack = new DueBackCampaigns(registry);
        organizationId = _register();

        vm.prank(ADMIN);
        registry.setIssuer(organizationId, ISSUER, true);

        campaignId = dueBack.campaignIdFor(organizationId, REFERENCE);
        leafA = dueBack.leafFor(
            campaignId, 0, CLAIM_A, AMOUNT_A, keccak256(abi.encodePacked(SECRET_A))
        );
        leafB = dueBack.leafFor(
            campaignId, 1, CLAIM_B, AMOUNT_B, keccak256(abi.encodePacked(SECRET_B))
        );
        root = _hashPair(leafA, leafB);
        vm.deal(ISSUER, 100 ether);
    }

    function testCreatesExactlyFundedImmutableCampaign() external {
        _create();
        DueBackCampaigns.Campaign memory campaign = dueBack.getCampaign(campaignId);

        require(campaign.organizationId == organizationId, "wrong organization");
        require(campaign.merkleRoot == root, "wrong root");
        require(campaign.issuer == ISSUER, "wrong issuer");
        require(campaign.reclaimAddress == RECLAIM, "wrong reclaim address");
        require(campaign.totalAmount == AMOUNT_A + AMOUNT_B, "wrong total");
        require(address(dueBack).balance == AMOUNT_A + AMOUNT_B, "funding not retained");
    }

    function testRejectsUnderfundingAndOverfunding() external {
        DueBackCampaigns.CampaignRequest memory request = _request();

        vm.prank(ISSUER);
        vm.expectPartialRevert(DueBackCampaigns.IncorrectFunding.selector);
        dueBack.createCampaign{value: AMOUNT_A}(request);

        vm.prank(ISSUER);
        vm.expectPartialRevert(DueBackCampaigns.IncorrectFunding.selector);
        dueBack.createCampaign{value: AMOUNT_A + AMOUNT_B + 1}(request);
    }

    function testRejectsUnknownOrInactiveIssuer() external {
        DueBackCampaigns.CampaignRequest memory request = _request();

        vm.deal(address(0xBAD), request.totalAmount);
        vm.prank(address(0xBAD));
        vm.expectPartialRevert(DueBackCampaigns.UnauthorizedIssuer.selector);
        dueBack.createCampaign{value: request.totalAmount}(request);

        vm.prank(ADMIN);
        registry.setActive(organizationId, false);
        vm.prank(ISSUER);
        vm.expectPartialRevert(DueBackCampaigns.OrganizationInactive.selector);
        dueBack.createCampaign{value: request.totalAmount}(request);
    }

    function testCampaignUsesReclaimAddressAtCreation() external {
        DueBackCampaigns.CampaignRequest memory first = _request();
        vm.prank(ISSUER);
        dueBack.createCampaign{value: first.totalAmount}(first);

        vm.prank(ADMIN);
        registry.proposeReclaimAddress(organizationId, NEW_RECLAIM);
        OrganizationRegistry.OrganizationView memory organization =
            registry.getOrganization(organizationId);
        vm.warp(organization.pendingReclaimActivatesAt);
        registry.activateReclaimAddress(organizationId);

        bytes32 secondReference = keccak256("campaign-2026-002");
        bytes32 secondCampaignId = dueBack.campaignIdFor(organizationId, secondReference);
        DueBackCampaigns.CampaignRequest memory second = first;
        second.campaignReference = secondReference;
        second.opensAt = uint64(block.timestamp);
        second.closesAt = uint64(block.timestamp + 7 days);
        vm.prank(ISSUER);
        dueBack.createCampaign{value: second.totalAmount}(second);

        require(dueBack.getCampaign(campaignId).reclaimAddress == RECLAIM, "old route changed");
        require(
            dueBack.getCampaign(secondCampaignId).reclaimAddress == NEW_RECLAIM,
            "new route not used"
        );
    }

    function testValidClaimPaysExactAmount() external {
        _create();
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        uint256 beforeBalance = RECIPIENT_A.balance;

        vm.prank(RECIPIENT_A);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);

        DueBackCampaigns.Campaign memory campaign = dueBack.getCampaign(campaignId);
        require(RECIPIENT_A.balance == beforeBalance + AMOUNT_A, "recipient not paid");
        require(campaign.claimedAmount == AMOUNT_A, "claimed amount not updated");
        require(campaign.claimedCount == 1, "claimed count not updated");
        require(dueBack.isClaimed(campaignId, 0), "claim bit not set");
    }

    function testRejectsDuplicateClaim() external {
        _create();
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        vm.prank(RECIPIENT_A);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);

        vm.prank(RECIPIENT_A);
        vm.expectPartialRevert(DueBackCampaigns.ClaimAlreadyPaid.selector);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);
    }

    function testRejectsWrongSecretModifiedAmountAndWrongProof() external {
        _create();
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;

        vm.prank(RECIPIENT_A);
        vm.expectPartialRevert(DueBackCampaigns.InvalidClaim.selector);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_B, proof);

        vm.prank(RECIPIENT_A);
        vm.expectPartialRevert(DueBackCampaigns.InvalidClaim.selector);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A + 1, SECRET_A, proof);

        proof[0] = keccak256("not-a-sibling");
        vm.prank(RECIPIENT_A);
        vm.expectPartialRevert(DueBackCampaigns.InvalidClaim.selector);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);
    }

    function testEnforcesOpeningAndClosingTimes() external {
        DueBackCampaigns.CampaignRequest memory request = _request();
        request.opensAt = uint64(block.timestamp + 1 days);
        request.closesAt = uint64(block.timestamp + 2 days);
        vm.prank(ISSUER);
        dueBack.createCampaign{value: request.totalAmount}(request);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        vm.prank(RECIPIENT_A);
        vm.expectPartialRevert(DueBackCampaigns.CampaignNotOpen.selector);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);

        vm.warp(request.closesAt);
        vm.prank(RECIPIENT_A);
        vm.expectPartialRevert(DueBackCampaigns.CampaignClosed.selector);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);
    }

    function testReclaimsOnlyAfterCloseAndOnlyOnce() external {
        DueBackCampaigns.CampaignRequest memory request = _request();
        vm.prank(ISSUER);
        dueBack.createCampaign{value: request.totalAmount}(request);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        vm.prank(RECIPIENT_A);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proof);

        vm.expectPartialRevert(DueBackCampaigns.ReclaimNotReady.selector);
        dueBack.reclaim(campaignId);

        uint256 beforeBalance = RECLAIM.balance;
        vm.warp(request.closesAt);
        dueBack.reclaim(campaignId);

        DueBackCampaigns.Campaign memory campaign = dueBack.getCampaign(campaignId);
        require(RECLAIM.balance == beforeBalance + AMOUNT_B, "wrong reclaim transfer");
        require(campaign.reclaimedAmount == AMOUNT_B, "wrong reclaimed accounting");
        require(campaign.reclaimed, "reclaim not final");
        require(address(dueBack).balance == 0, "campaign funds remain");

        vm.expectPartialRevert(DueBackCampaigns.ReclaimAlreadyCompleted.selector);
        dueBack.reclaim(campaignId);
    }

    function testAllClaimedCampaignReclaimsZero() external {
        DueBackCampaigns.CampaignRequest memory request = _request();
        vm.prank(ISSUER);
        dueBack.createCampaign{value: request.totalAmount}(request);

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;
        vm.prank(RECIPIENT_A);
        dueBack.claim(campaignId, 0, CLAIM_A, AMOUNT_A, SECRET_A, proofA);

        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = leafA;
        vm.prank(RECIPIENT_B);
        dueBack.claim(campaignId, 1, CLAIM_B, AMOUNT_B, SECRET_B, proofB);

        uint256 beforeBalance = RECLAIM.balance;
        vm.warp(request.closesAt);
        dueBack.reclaim(campaignId);
        DueBackCampaigns.Campaign memory campaign = dueBack.getCampaign(campaignId);
        require(RECLAIM.balance == beforeBalance, "zero reclaim transferred value");
        require(campaign.reclaimedAmount == 0, "zero reclaim accounting wrong");
        require(campaign.claimedAmount == campaign.totalAmount, "not fully claimed");
    }

    function _create() private {
        DueBackCampaigns.CampaignRequest memory request = _request();
        vm.prank(ISSUER);
        dueBack.createCampaign{value: request.totalAmount}(request);
    }

    function _request() private view returns (DueBackCampaigns.CampaignRequest memory) {
        return DueBackCampaigns.CampaignRequest({
            organizationId: organizationId,
            campaignReference: REFERENCE,
            merkleRoot: root,
            policyHash: keccak256("policy"),
            metadataHash: keccak256("metadata"),
            noticeHash: keccak256("notice"),
            supersedesCampaignId: bytes32(0),
            totalAmount: AMOUNT_A + AMOUNT_B,
            opensAt: uint64(block.timestamp),
            closesAt: uint64(block.timestamp + 7 days),
            recipientCount: 2
        });
    }

    function _register() private returns (bytes32 id) {
        string memory domain = "refunds.example";
        id = registry.organizationIdFor(domain);
        uint64 validUntil = uint64(block.timestamp + 30 days);
        bytes32 nonce = keccak256("registration");
        OrganizationRegistry.DomainAttestation memory attestation =
            OrganizationRegistry.DomainAttestation({
                organizationId: id, admin: ADMIN, validUntil: validUntil, nonce: nonce
            });
        bytes memory signature = _sign(ATTESTOR_KEY, registry.hashDomainAttestation(attestation));

        vm.prank(ADMIN);
        registry.registerOrganization(
            domain, "Refunds Example", RECLAIM, validUntil, nonce, signature
        );
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return left < right
            ? keccak256(abi.encodePacked(left, right))
            : keccak256(abi.encodePacked(right, left));
    }
}

