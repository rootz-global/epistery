// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Agent {
  // Mapping from wallet address to array of data (IPFS hashes)
  mapping(address => string[]) private addressData;

  // Mapping from wallet address to array of public keys
  mapping(address => string[]) private addressPublicKeys;

  // Mapping from wallet address to map of domain to array of white-listed addresses
  // Ex: ["0x1000"] --> ["localhost"]["0x2000", "0x3000", "0x4000", ...]
  mapping(address => mapping(string => address[])) private domainWhitelist;

  // Event emitted when data is written
  event DataWritten(address indexed owner, string publicKey, string data, uint256 timestamp);

  // Event emitted when ownership is transferred
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner, uint256 timestamp);

  /**
   * @dev Writes data for the caller's address
   * Appends new data to the caller's message history
   * @param publicKey The public key to associate with this address
   * @param data The data to store (IPFS hash)
   */
  function write(string memory publicKey, string memory data) public {
    require(bytes(publicKey).length > 0, "Public key cannot be empty");
    require(bytes(data).length > 0, "Data cannot be empty");

    // Append data to msg.sender's array
    addressData[msg.sender].push(data);
    addressPublicKeys[msg.sender].push(publicKey);

    emit DataWritten(msg.sender, publicKey, data, block.timestamp);
  }

  /**
   * @dev Reads all data for the caller's address
   * Returns empty array if no data exists
   * @return Array of all IPFS hashes associated with the caller's address
   */
  function read() public view returns (string[] memory) {
    return addressData[msg.sender];
  }

  /**
   * @dev Gets the count of messages for the caller
   * @return The number of messages stored for the caller
   */
  function getMessageCount() public view returns (uint256) {
    return addressData[msg.sender].length;
  }

  /**
   * @dev Transfers ownership of all data to a new address
   * Moves all data and public keys from caller to new owner
   * Clears the caller's data after transfer
   * @param newOwner The address to transfer ownership to
   */
  function transferOwnership(address newOwner) public {
    require(newOwner != address(0), "New owner cannot be zero address");
    require(newOwner != msg.sender, "Cannot transfer to self");
    require(addressData[msg.sender].length > 0, "No data to transfer");

    // Transfer all data to new owner
    uint256 length = addressData[msg.sender].length;
    for (uint256 i = 0; i < length; i++) {
      addressData[newOwner].push(addressData[msg.sender][i]);
      addressPublicKeys[newOwner].push(addressPublicKeys[msg.sender][i]);
    }

    // Clear old owner's data
    delete addressData[msg.sender];
    delete addressPublicKeys[msg.sender];

    emit OwnershipTransferred(msg.sender, newOwner, block.timestamp);
  }

  function addToWhitelist(address addressToAdd, string memory domain) external {
    domainWhitelist[msg.sender][domain].push(addressToAdd);
  }

  function removeFromWhitelist(address addressToRemove, string memory domain) external {
    address[] storage whitelist = domainWhitelist[msg.sender][domain];
    for (uint256 i = 0; i < whitelist.length; i++) {
      if (whitelist[i] == addressToRemove) {
          whitelist[i] = whitelist[whitelist.length - 1];
          whitelist.pop();
          break;
      }
    }
  }

  function getWhitelist(address wallet, string memory domain) external view returns (address[] memory) {
    return domainWhitelist[wallet][domain];
  }

  function isWhitelisted(address wallet, string memory domain, address addressToCheck) external view returns (bool) {
    address[] memory whitelist = domainWhitelist[wallet][domain];
    for (uint256 i = 0; i < whitelist.length; i++) {
      if (whitelist[i] == addressToCheck) {
          return true;
      }
    }
    return false;
  }
}
