// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Agent {
    // Mapping from wallet address to data (IPFS hash)
    mapping(address => string) private addressData;

    // Mapping from wallet address to public key
    mapping(address => string) private addressPublicKeys;

    // Event emitted when data is written
    event DataWritten(address indexed owner, string publicKey, string data, uint256 timestamp);

    /**
     * @dev Writes data for the caller's address
     * Only the wallet owner can write/update their own data
     * @param publicKey The public key to associate with this address
     * @param data The data to store (IPFS hash)
     */
    function write(string memory publicKey, string memory data) public {
        require(bytes(publicKey).length > 0, "Public key cannot be empty");
        require(bytes(data).length > 0, "Data cannot be empty");

        // Store data by msg.sender (wallet address)
        addressData[msg.sender] = data;
        addressPublicKeys[msg.sender] = publicKey;

        emit DataWritten(msg.sender, publicKey, data, block.timestamp);
    }

    /**
     * @dev Reads data for the caller's address
     * Returns empty string if no data exists (not an error)
     * @return The data associated with the caller's address
     */
    function read() public view returns (string memory) {
        return addressData[msg.sender];
    }
}
