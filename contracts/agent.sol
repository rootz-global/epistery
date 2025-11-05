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

  // Event emitted when approval is requested
  event ApprovalRequested(address indexed approver, address indexed requestor, string fileName, string fileHash, uint256 timestamp);

  // Event emitted when approval is handled
  event ApprovalHandled(address indexed approver, address indexed requestor, string fileName, bool approved, uint256 timestamp);

  // Struct for requests
  struct ApprovalRequest {
    bool approved;
    string fileName;
    string fileHash;
    uint256 processedAt;
    bool exists;
  }

  // Struct for requests with requestor info
  struct ApprovalWithRequestor {
    address requestor;
    bool approved;
    string fileName;
    string fileHash;
    uint256 processedAt;
    bool exists;
  }

  // Mapping from approver address to requestor address to array of requests
  mapping(address => mapping(address => ApprovalRequest[])) private approvalRequests;

  // Mapping from approver address to array of requestor addresses
  mapping(address => address[]) private approverRequestors;

  // Mapping from requestor address to array of approver addresses
  mapping(address => address[]) private requestorApprovers;

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

  /**
   * @dev Creates a request for a file
   * @param approverAddress The address that will approve/deny the request
   * @param fileName The name of the file being requested
   * @param fileHash The hash of the file being requested
   * @param domain The domain context for the request
   */
  function createApproval(address approverAddress, string memory fileName, string memory fileHash, string memory domain) external {
    require(approverAddress != address(0), "Approver cannot be zero address");
    require(bytes(fileName).length > 0, "File name cannot be empty");
    require(bytes(fileHash).length > 0, "File hash cannot be empty");

    // Add requestor to approver's requestor list if not already present
    bool requestorExists = false;
    address[] storage requestors = approverRequestors[approverAddress];
    for (uint256 i = 0; i < requestors.length; i++) {
      if (requestors[i] == msg.sender) {
        requestorExists = true;
        break;
      }
    }
    if (!requestorExists) {
      approverRequestors[approverAddress].push(msg.sender);
    }

    // Add approver to requestor's approver list if not already present
    bool approverExists = false;
    address[] storage approvers = requestorApprovers[msg.sender];
    for (uint256 i = 0; i < approvers.length; i++) {
      if (approvers[i] == approverAddress) {
        approverExists = true;
        break;
      }
    }
    if (!approverExists) {
      requestorApprovers[msg.sender].push(approverAddress);
    }

    // Create the request
    ApprovalRequest memory newRequest = ApprovalRequest({
      approved: false,
      fileName: fileName,
      fileHash: fileHash,
      processedAt: 0,
      exists: true
    });

    approvalRequests[approverAddress][msg.sender].push(newRequest);

    emit ApprovalRequested(approverAddress, msg.sender, fileName, fileHash, block.timestamp);
  }

  /**
   * @dev Gets all requests for a specific requestor address
   * @param approverAddress The address of the approver
   * @param requestorAddress The address of the requestor
   * @return Array of requests
   */
  function getApprovalsByAddress(address approverAddress, address requestorAddress) external view returns (ApprovalRequest[] memory) {
    return approvalRequests[approverAddress][requestorAddress];
  }

  /**
   * @dev Gets all requests for an approver from all requestors
   * @param approverAddress The address of the approver
   * @return Array of requests with requestor information
   */
  function getAllApprovalsForApprover(address approverAddress) external view returns (ApprovalWithRequestor[] memory) {
    address[] memory requestors = approverRequestors[approverAddress];

    // First, count total number of requests
    uint256 totalRequests = 0;
    for (uint256 i = 0; i < requestors.length; i++) {
      totalRequests += approvalRequests[approverAddress][requestors[i]].length;
    }

    // Create array to hold all requests
    ApprovalWithRequestor[] memory allRequests = new ApprovalWithRequestor[](totalRequests);

    // Populate the array
    uint256 currentIndex = 0;
    for (uint256 i = 0; i < requestors.length; i++) {
      address requestor = requestors[i];
      ApprovalRequest[] memory requests = approvalRequests[approverAddress][requestor];

      for (uint256 j = 0; j < requests.length; j++) {
        allRequests[currentIndex] = ApprovalWithRequestor({
          requestor: requestor,
          approved: requests[j].approved,
          fileName: requests[j].fileName,
          fileHash: requests[j].fileHash,
          processedAt: requests[j].processedAt,
          exists: requests[j].exists
        });
        currentIndex++;
      }
    }

    return allRequests;
  }

  /**
   * @dev Gets all requests for a requestor from all approvers
   * @param requestorAddress The address of the requestor
   * @return Array of requests with approver information
   */
  function getAllApprovalsForRequestor(address requestorAddress) external view returns (ApprovalWithRequestor[] memory) {
    address[] memory approvers = requestorApprovers[requestorAddress];

    // First, count total number of requests
    uint256 totalRequests = 0;
    for (uint256 i = 0; i < approvers.length; i++) {
      totalRequests += approvalRequests[approvers[i]][requestorAddress].length;
    }

    // Create array to hold all requests
    ApprovalWithRequestor[] memory allRequests = new ApprovalWithRequestor[](totalRequests);

    // Populate the array
    uint256 currentIndex = 0;
    for (uint256 i = 0; i < approvers.length; i++) {
      address approver = approvers[i];
      ApprovalRequest[] memory requests = approvalRequests[approver][requestorAddress];

      for (uint256 j = 0; j < requests.length; j++) {
        allRequests[currentIndex] = ApprovalWithRequestor({
          requestor: approver, // Store the approver address in the requestor field
          approved: requests[j].approved,
          fileName: requests[j].fileName,
          fileHash: requests[j].fileHash,
          processedAt: requests[j].processedAt,
          exists: requests[j].exists
        });
        currentIndex++;
      }
    }

    return allRequests;
  }

  /**
   * @dev Handles a request (approve or deny)
   * Only the approver can handle their requests
   * Automatically finds and processes the first unprocessed request from the requestor
   * @param requestorAddress The address that requested the approval
   * @param fileName The name of the file to approve/deny
   * @param approved Whether to approve or deny the request
   */
  function handleApproval(address requestorAddress, string memory fileName, bool approved) external {
    require(requestorAddress != address(0), "Requestor cannot be zero address");
    require(bytes(fileName).length > 0, "File name cannot be empty");

    ApprovalRequest[] storage requests = approvalRequests[msg.sender][requestorAddress];
    require(requests.length > 0, "No requests from this requestor");

    // Find the first unprocessed request with matching fileName
    bool found = false;
    for (uint256 i = 0; i < requests.length; i++) {
      if (requests[i].processedAt == 0 &&
          keccak256(bytes(requests[i].fileName)) == keccak256(bytes(fileName))) {
        requests[i].approved = approved;
        requests[i].processedAt = block.timestamp;

        emit ApprovalHandled(msg.sender, requestorAddress, requests[i].fileName, approved, block.timestamp);
        found = true;
        break;
      }
    }

    require(found, "No unprocessed request found with this file name");
  }
}
