// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {MerkleProof} from "./MerkleProof.sol";
import {OrganizationRegistry} from "./OrganizationRegistry.sol";

contract DueBackCampaigns {
    struct Campaign {
        bytes32 organizationId;
        bytes32 merkleRoot;
        bytes32 policyHash;
        bytes32 metadataHash;
        bytes32 noticeHash;
        bytes32 supersedesCampaignId;
        address issuer;
        address reclaimAddress;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 reclaimedAmount;
        uint64 opensAt;
        uint64 closesAt;
        uint32 recipientCount;
        uint32 claimedCount;
        bool reclaimed;
    }

    struct CampaignRequest {
        bytes32 organizationId;
        bytes32 campaignReference;
        bytes32 merkleRoot;
        bytes32 policyHash;
        bytes32 metadataHash;
        bytes32 noticeHash;
        bytes32 supersedesCampaignId;
        uint256 totalAmount;
        uint64 opensAt;
        uint64 closesAt;
        uint32 recipientCount;
    }

    error CampaignAlreadyExists(bytes32 campaignId);
    error CampaignClosed(uint64 closesAt);
    error CampaignNotFound(bytes32 campaignId);
    error CampaignNotOpen(uint64 opensAt);
    error ClaimAlreadyPaid(uint256 index);
    error DomainVerificationExpired(uint64 validUntil);
    error IncorrectFunding(uint256 expected, uint256 received);
    error InvalidCampaignData();
    error InvalidClaim();
    error OrganizationInactive(bytes32 organizationId);
    error ReclaimAlreadyCompleted(bytes32 campaignId);
    error ReclaimNotReady(uint64 closesAt);
    error TransferFailed(address recipient);
    error ReentrantCall();
    error UnauthorizedIssuer(address issuer);

    event CampaignCreated(
        bytes32 indexed campaignId,
        bytes32 indexed organizationId,
        address indexed issuer,
        bytes32 campaignReference,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint32 recipientCount,
        uint64 opensAt,
        uint64 closesAt,
        address reclaimAddress
    );
    event CampaignCommitments(
        bytes32 indexed campaignId,
        bytes32 policyHash,
        bytes32 metadataHash,
        bytes32 noticeHash,
        bytes32 supersedesCampaignId
    );
    event ClaimPaid(
        bytes32 indexed campaignId,
        uint256 indexed index,
        bytes32 indexed claimId,
        address recipient,
        uint256 amount
    );
    event CampaignReclaimed(
        bytes32 indexed campaignId, address indexed reclaimAddress, uint256 amount
    );

    uint64 public constant MAX_CAMPAIGN_DURATION = 366 days;

    OrganizationRegistry public immutable registry;
    mapping(bytes32 campaignId => Campaign campaign) private campaigns;
    mapping(bytes32 campaignId => mapping(uint256 wordIndex => uint256 bitmap)) private claimed;
    uint256 private reentrancyState = 1;

    constructor(OrganizationRegistry registry_) {
        if (address(registry_) == address(0)) revert InvalidCampaignData();
        registry = registry_;
    }

    function createCampaign(CampaignRequest calldata request)
        external
        payable
        returns (bytes32 campaignId)
    {
        if (
            request.organizationId == bytes32(0) || request.campaignReference == bytes32(0)
                || request.merkleRoot == bytes32(0) || request.policyHash == bytes32(0)
                || request.metadataHash == bytes32(0) || request.noticeHash == bytes32(0)
                || request.totalAmount == 0 || request.recipientCount == 0
                || request.opensAt < block.timestamp || request.closesAt <= request.opensAt
                || request.closesAt - request.opensAt > MAX_CAMPAIGN_DURATION
        ) revert InvalidCampaignData();
        if (msg.value != request.totalAmount) {
            revert IncorrectFunding(request.totalAmount, msg.value);
        }

        campaignId = campaignIdFor(request.organizationId, request.campaignReference);
        if (campaigns[campaignId].issuer != address(0)) {
            revert CampaignAlreadyExists(campaignId);
        }

        OrganizationRegistry.OrganizationView memory organization =
            registry.getOrganization(request.organizationId);
        if (!organization.active) revert OrganizationInactive(request.organizationId);
        if (organization.domainVerifiedUntil <= block.timestamp) {
            revert DomainVerificationExpired(organization.domainVerifiedUntil);
        }
        if (!registry.isAuthorizedIssuer(request.organizationId, msg.sender)) {
            revert UnauthorizedIssuer(msg.sender);
        }

        campaigns[campaignId] = Campaign({
            organizationId: request.organizationId,
            merkleRoot: request.merkleRoot,
            policyHash: request.policyHash,
            metadataHash: request.metadataHash,
            noticeHash: request.noticeHash,
            supersedesCampaignId: request.supersedesCampaignId,
            issuer: msg.sender,
            reclaimAddress: organization.reclaimAddress,
            totalAmount: request.totalAmount,
            claimedAmount: 0,
            reclaimedAmount: 0,
            opensAt: request.opensAt,
            closesAt: request.closesAt,
            recipientCount: request.recipientCount,
            claimedCount: 0,
            reclaimed: false
        });

        emit CampaignCreated(
            campaignId,
            request.organizationId,
            msg.sender,
            request.campaignReference,
            request.merkleRoot,
            request.totalAmount,
            request.recipientCount,
            request.opensAt,
            request.closesAt,
            organization.reclaimAddress
        );
        emit CampaignCommitments(
            campaignId,
            request.policyHash,
            request.metadataHash,
            request.noticeHash,
            request.supersedesCampaignId
        );
    }

    function claim(
        bytes32 campaignId,
        uint256 index,
        bytes32 claimId,
        uint256 amount,
        bytes32 secret,
        bytes32[] calldata proof
    ) external {
        if (reentrancyState != 1) revert ReentrantCall();
        reentrancyState = 2;

        Campaign storage campaign = _requireCampaign(campaignId);
        if (block.timestamp < campaign.opensAt) revert CampaignNotOpen(campaign.opensAt);
        if (block.timestamp >= campaign.closesAt) revert CampaignClosed(campaign.closesAt);
        if (
            index >= campaign.recipientCount || claimId == bytes32(0) || amount == 0
                || secret == bytes32(0)
        ) revert InvalidClaim();
        if (isClaimed(campaignId, index)) revert ClaimAlreadyPaid(index);

        bytes32 leaf =
            leafFor(campaignId, index, claimId, amount, keccak256(abi.encodePacked(secret)));
        if (!MerkleProof.verifyCalldata(proof, campaign.merkleRoot, leaf)) {
            revert InvalidClaim();
        }
        if (campaign.claimedAmount + amount > campaign.totalAmount) revert InvalidClaim();

        _setClaimed(campaignId, index);
        campaign.claimedAmount += amount;
        campaign.claimedCount += 1;

        emit ClaimPaid(campaignId, index, claimId, msg.sender, amount);
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed(msg.sender);

        reentrancyState = 1;
    }

    function reclaim(bytes32 campaignId) external {
        if (reentrancyState != 1) revert ReentrantCall();
        reentrancyState = 2;

        Campaign storage campaign = _requireCampaign(campaignId);
        if (block.timestamp < campaign.closesAt) revert ReclaimNotReady(campaign.closesAt);
        if (campaign.reclaimed) revert ReclaimAlreadyCompleted(campaignId);

        uint256 amount = campaign.totalAmount - campaign.claimedAmount;
        campaign.reclaimed = true;
        campaign.reclaimedAmount = amount;

        emit CampaignReclaimed(campaignId, campaign.reclaimAddress, amount);
        if (amount > 0) {
            (bool success,) = campaign.reclaimAddress.call{value: amount}("");
            if (!success) revert TransferFailed(campaign.reclaimAddress);
        }

        reentrancyState = 1;
    }

    function getCampaign(bytes32 campaignId) external view returns (Campaign memory) {
        return _requireCampaign(campaignId);
    }

    function isClaimed(bytes32 campaignId, uint256 index) public view returns (bool) {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 255;
        uint256 mask = 1 << bitIndex;
        return claimed[campaignId][wordIndex] & mask == mask;
    }

    function campaignIdFor(bytes32 organizationId, bytes32 campaignReference)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(organizationId, campaignReference));
    }

    function leafFor(
        bytes32 campaignId,
        uint256 index,
        bytes32 claimId,
        uint256 amount,
        bytes32 secretHash
    ) public pure returns (bytes32) {
        return keccak256(
            bytes.concat(keccak256(abi.encode(campaignId, index, claimId, amount, secretHash)))
        );
    }

    function _setClaimed(bytes32 campaignId, uint256 index) private {
        uint256 wordIndex = index >> 8;
        uint256 bitIndex = index & 255;
        claimed[campaignId][wordIndex] |= 1 << bitIndex;
    }

    function _requireCampaign(bytes32 campaignId) private view returns (Campaign storage campaign) {
        campaign = campaigns[campaignId];
        if (campaign.issuer == address(0)) revert CampaignNotFound(campaignId);
    }
}
