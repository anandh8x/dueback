// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

library MerkleProof {
    function verifyCalldata(bytes32[] calldata proof, bytes32 root, bytes32 leaf)
        internal
        pure
        returns (bool)
    {
        return processProofCalldata(proof, leaf) == root;
    }

    function processProofCalldata(bytes32[] calldata proof, bytes32 leaf)
        internal
        pure
        returns (bytes32 computedHash)
    {
        computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return left < right ? _efficientHash(left, right) : _efficientHash(right, left);
    }

    function _efficientHash(bytes32 left, bytes32 right) private pure returns (bytes32 value) {
        assembly ("memory-safe") {
            mstore(0x00, left)
            mstore(0x20, right)
            value := keccak256(0x00, 0x40)
        }
    }
}

