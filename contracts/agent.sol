// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Agent {
  // Contract version - increment when ABI or functionality changes
  string public constant VERSION = "3.1.1";

  // Domain name set at contract deployment (stored as state variable since strings can't be immutable)
  string public domain;

  // Immutable sponsor address - the address that paid for deployment
  address public immutable sponsor;

  // ============================================================================
  // RIVET ITEM DATA STRUCTURE
  //
  // Core data structure for messages and posts
  // ============================================================================

  enum Visibility { Public, Private }

  struct RivetItem {
    address from;        // Author/sender of the item
    address to;          // Recipient (address(0) for posts, specific address for DMs)
    string data;         // Metadata or short content
    string publicKey;    // Public key of the sender
    string domain;       // Domain context
    string ipfsHash;     // IPFS hash of full content
    Visibility visibility;
    uint256 timestamp;
  }

  // Conversations between two addresses (deterministic conversation ID)
  mapping(bytes32 => RivetItem[]) private conversations;

  // Posts on boards (address as board identifier)
  mapping(address => RivetItem[]) private posts;

  // Mapping from wallet address to array of public keys (for key exchange)
  mapping(address => string[]) private addressPublicKeys;

  // Track conversation IDs for each participant (for enumeration)
  mapping(address => bytes32[]) private userConversationIds;

  // Struct for whitelist entry with metadata
  struct WhitelistEntry {
    address addr;
    string name;
    uint8 role; // 0=none, 1=read, 2=edit, 3=admin, 4=owner
    string meta; // JSON or stringified JSON for arbitrary extension data
  }

  // Named whitelists: owner => listName => WhitelistEntry[]
  // List names follow format: "type::resource" (e.g., "domain::wiki.rootz.global", "channel::general")
  mapping(address => mapping(string => WhitelistEntry[])) private namedWhitelists;

  // Track which list names an owner has created (for enumeration)
  mapping(address => string[]) private ownerListNames;

  // Struct for tracking a member's list membership with timestamp
  struct MembershipEntry {
    string listName;
    uint8 role;
    uint256 addedAt;
  }

  // Track which lists a member address belongs to: owner => member => MembershipEntry[]
  mapping(address => mapping(address => MembershipEntry[])) private memberMemberships;

  /**
   * @dev Constructor sets the immutable domain name and sponsor
   * @param _domain The domain name this contract is deployed for
   * @param _sponsor The address that paid for the deployment
   */
  constructor(string memory _domain, address _sponsor) {
    require(bytes(_domain).length > 0, "Domain cannot be empty");
    require(_sponsor != address(0), "Sponsor cannot be zero address");
    domain = _domain;
    sponsor = _sponsor;
  }

  // Event emitted when a message is sent (DM)
  event MessageSent(address indexed from, address indexed to, string ipfsHash, string domain, uint256 timestamp);

  // Event emitted when a post is created
  event PostCreated(address indexed from, address indexed board, string ipfsHash, string domain, Visibility visibility, uint256 timestamp);

  // Event emitted when data is written (legacy - maps to PostCreated)
  event DataWritten(address indexed owner, string publicKey, string data, uint256 timestamp);

  // Event emitted when ownership is transferred
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner, uint256 timestamp);

  // Event emitted when approval is requested
  event ApprovalRequested(address indexed approver, address indexed requestor, string fileName, string fileHash, uint256 timestamp);

  // Event emitted when approval is handled
  event ApprovalHandled(address indexed approver, address indexed requestor, string fileName, bool approved, uint256 timestamp);

  // Event emitted when whitelist is modified
  event WhitelistModified(address indexed owner, string listName, address indexed addr, string action, uint256 timestamp);

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

  // Generic attribute storage
  // Public attributes - readable by anyone
  mapping(string => string) public publicAttributes;

  // Private attributes - only readable by owner and admins
  mapping(string => string) private privateAttributes;

  // Track attribute keys for enumeration
  string[] private publicAttributeKeys;
  string[] private privateAttributeKeys;

  // Admin addresses who can read/write private attributes
  mapping(address => bool) private administrators;

  // Event emitted when an attribute is set
  event AttributeSet(string indexed key, bool isPublic, uint256 timestamp);

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * @dev Generate deterministic conversation ID for two addresses
   * The ID is the same regardless of which address is first
   * @param addr1 First address
   * @param addr2 Second address
   * @return Deterministic conversation ID
   */
  function getConversationId(address addr1, address addr2) public pure returns (bytes32) {
    (address min, address max) = addr1 < addr2 ? (addr1, addr2) : (addr2, addr1);
    return keccak256(abi.encodePacked(min, max));
  }

  // ============================================================================
  // WRITE FUNCTIONS
  // ============================================================================

  /**
   * @dev Writes data for the caller's address (LEGACY - backward compatible)
   * Creates a public post on the caller's own board
   * @param publicKey The public key to associate with this address
   * @param data The data to store (IPFS hash)
   */
  function write(string memory publicKey, string memory data) public {
    require(bytes(publicKey).length > 0, "Public key cannot be empty");
    require(bytes(data).length > 0, "Data cannot be empty");

    // Store public key
    addressPublicKeys[msg.sender].push(publicKey);

    // Create a post on sender's own board (backward compatible behavior)
    posts[msg.sender].push(RivetItem({
      from: msg.sender,
      to: address(0),
      data: "",
      publicKey: publicKey,
      domain: domain,
      ipfsHash: data,
      visibility: Visibility.Public,
      timestamp: block.timestamp
    }));

    emit DataWritten(msg.sender, publicKey, data, block.timestamp);
    emit PostCreated(msg.sender, msg.sender, data, domain, Visibility.Public, block.timestamp);
  }

  /**
   * @dev Send a direct message to another address
   * Messages are stored in a shared conversation accessible by both parties
   * @param to Recipient address
   * @param publicKey Sender's public key
   * @param data Metadata or short content
   * @param messageDomain Domain context for the message
   * @param ipfsHash IPFS hash of the full message content
   */
  function sendMessage(
    address to,
    string memory publicKey,
    string memory data,
    string memory messageDomain,
    string memory ipfsHash
  ) external {
    require(to != address(0), "Recipient cannot be zero address");
    require(to != msg.sender, "Cannot message yourself");
    require(bytes(ipfsHash).length > 0, "IPFS hash cannot be empty");

    bytes32 convId = getConversationId(msg.sender, to);

    // Track conversation for both participants if this is first message
    if (conversations[convId].length == 0) {
      userConversationIds[msg.sender].push(convId);
      userConversationIds[to].push(convId);
    }

    conversations[convId].push(RivetItem({
      from: msg.sender,
      to: to,
      data: data,
      publicKey: publicKey,
      domain: messageDomain,
      ipfsHash: ipfsHash,
      visibility: Visibility.Private,
      timestamp: block.timestamp
    }));

    // Store public key if not empty
    if (bytes(publicKey).length > 0) {
      addressPublicKeys[msg.sender].push(publicKey);
    }

    emit MessageSent(msg.sender, to, ipfsHash, messageDomain, block.timestamp);
  }

  /**
   * @dev Create a post on a board
   * @param board Address of the board to post to (can be own address or another's)
   * @param publicKey Sender's public key
   * @param data Metadata or short content
   * @param postDomain Domain context for the post
   * @param ipfsHash IPFS hash of the full post content
   * @param visibility Public or Private visibility
   */
  function createPost(
    address board,
    string memory publicKey,
    string memory data,
    string memory postDomain,
    string memory ipfsHash,
    Visibility visibility
  ) external {
    require(bytes(ipfsHash).length > 0, "IPFS hash cannot be empty");

    posts[board].push(RivetItem({
      from: msg.sender,
      to: address(0),
      data: data,
      publicKey: publicKey,
      domain: postDomain,
      ipfsHash: ipfsHash,
      visibility: visibility,
      timestamp: block.timestamp
    }));

    // Store public key if not empty
    if (bytes(publicKey).length > 0) {
      addressPublicKeys[msg.sender].push(publicKey);
    }

    emit PostCreated(msg.sender, board, ipfsHash, postDomain, visibility, block.timestamp);
  }

  // ============================================================================
  // READ FUNCTIONS
  // ============================================================================

  /**
   * @dev Reads all IPFS hashes for the caller's posts (LEGACY - backward compatible)
   * Returns empty array if no posts exist
   * @return Array of all IPFS hashes from caller's posts
   */
  function read() public view returns (string[] memory) {
    RivetItem[] memory userPosts = posts[msg.sender];
    string[] memory hashes = new string[](userPosts.length);

    for (uint256 i = 0; i < userPosts.length; i++) {
      hashes[i] = userPosts[i].ipfsHash;
    }

    return hashes;
  }

  /**
   * @dev Gets the count of posts for the caller
   * @return The number of posts stored for the caller
   */
  function getMessageCount() public view returns (uint256) {
    return posts[msg.sender].length;
  }

  /**
   * @dev Gets all messages in a conversation between two addresses
   * Only participants can read their conversations
   * @param otherParty The other participant in the conversation
   * @return Array of RivetItems representing the conversation
   */
  function getConversation(address otherParty) external view returns (RivetItem[] memory) {
    require(otherParty != address(0), "Other party cannot be zero address");
    require(otherParty != msg.sender, "Cannot get conversation with yourself");

    bytes32 convId = getConversationId(msg.sender, otherParty);
    return conversations[convId];
  }

  /**
   * @dev Gets all conversation IDs for the caller
   * @return Array of conversation IDs the caller participates in
   */
  function getUserConversationIds() external view returns (bytes32[] memory) {
    return userConversationIds[msg.sender];
  }

  /**
   * @dev Gets all posts on a board
   * For public posts, anyone can read them
   * For private posts, only the board owner can read them
   * @param board The board address to get posts from
   * @return Array of RivetItems representing posts (filtered by visibility)
   */
  function getPosts(address board) external view returns (RivetItem[] memory) {
    RivetItem[] memory boardPosts = posts[board];

    // If caller is the board owner, return all posts
    if (msg.sender == board) {
      return boardPosts;
    }

    // For non-owners, count public posts first
    uint256 publicCount = 0;
    for (uint256 i = 0; i < boardPosts.length; i++) {
      if (boardPosts[i].visibility == Visibility.Public) {
        publicCount++;
      }
    }

    // Create array of only public posts
    RivetItem[] memory publicPosts = new RivetItem[](publicCount);
    uint256 index = 0;
    for (uint256 i = 0; i < boardPosts.length; i++) {
      if (boardPosts[i].visibility == Visibility.Public) {
        publicPosts[index] = boardPosts[i];
        index++;
      }
    }

    return publicPosts;
  }

  /**
   * @dev Gets posts on a board with pagination
   * @param board The board address to get posts from
   * @param offset Starting index
   * @param limit Maximum number of posts to return
   * @return Array of RivetItems (filtered by visibility)
   */
  function getPostsPaginated(address board, uint256 offset, uint256 limit) external view returns (RivetItem[] memory) {
    RivetItem[] memory boardPosts = posts[board];

    // If caller is board owner, return all posts with pagination
    if (msg.sender == board) {
      if (offset >= boardPosts.length) {
        return new RivetItem[](0);
      }

      uint256 end = offset + limit;
      if (end > boardPosts.length) {
        end = boardPosts.length;
      }

      RivetItem[] memory ownerResult = new RivetItem[](end - offset);
      for (uint256 i = offset; i < end; i++) {
        ownerResult[i - offset] = boardPosts[i];
      }
      return ownerResult;
    }

    // For non-owners, filter to public posts then paginate
    // First pass: count public posts
    uint256 publicCount = 0;
    for (uint256 i = 0; i < boardPosts.length; i++) {
      if (boardPosts[i].visibility == Visibility.Public) {
        publicCount++;
      }
    }

    if (offset >= publicCount) {
      return new RivetItem[](0);
    }

    uint256 resultSize = limit;
    if (offset + limit > publicCount) {
      resultSize = publicCount - offset;
    }

    RivetItem[] memory result = new RivetItem[](resultSize);
    uint256 publicIndex = 0;
    uint256 resultIndex = 0;

    for (uint256 i = 0; i < boardPosts.length && resultIndex < resultSize; i++) {
      if (boardPosts[i].visibility == Visibility.Public) {
        if (publicIndex >= offset) {
          result[resultIndex] = boardPosts[i];
          resultIndex++;
        }
        publicIndex++;
      }
    }

    return result;
  }

  /**
   * @dev Gets public keys for an address
   * @param addr The address to get public keys for
   * @return Array of public keys
   */
  function getPublicKeys(address addr) external view returns (string[] memory) {
    return addressPublicKeys[addr];
  }

  /**
   * @dev Transfers ownership of all data to a new address
   * Moves all posts, conversations, public keys, and approval requests from caller to new owner
   * Clears the caller's data after transfer
   * @param newOwner The address to transfer ownership to
   */
  function transferOwnership(address newOwner) public {
    require(newOwner != address(0), "New owner cannot be zero address");
    require(newOwner != msg.sender, "Cannot transfer to self");
    require(posts[msg.sender].length > 0 || userConversationIds[msg.sender].length > 0, "No data to transfer");

    // Transfer all posts to new owner's board
    RivetItem[] storage oldPosts = posts[msg.sender];
    for (uint256 i = 0; i < oldPosts.length; i++) {
      // Update the 'from' address in transferred posts
      posts[newOwner].push(RivetItem({
        from: newOwner,
        to: oldPosts[i].to,
        data: oldPosts[i].data,
        publicKey: oldPosts[i].publicKey,
        domain: oldPosts[i].domain,
        ipfsHash: oldPosts[i].ipfsHash,
        visibility: oldPosts[i].visibility,
        timestamp: oldPosts[i].timestamp
      }));
    }

    // Transfer public keys
    string[] storage oldKeys = addressPublicKeys[msg.sender];
    for (uint256 i = 0; i < oldKeys.length; i++) {
      addressPublicKeys[newOwner].push(oldKeys[i]);
    }

    // Transfer conversation IDs (note: messages in conversations keep original 'from' addresses)
    bytes32[] storage oldConvIds = userConversationIds[msg.sender];
    for (uint256 i = 0; i < oldConvIds.length; i++) {
      bytes32 convId = oldConvIds[i];
      // Add to new owner's conversation list if not already there
      bool exists = false;
      bytes32[] storage newOwnerConvIds = userConversationIds[newOwner];
      for (uint256 j = 0; j < newOwnerConvIds.length; j++) {
        if (newOwnerConvIds[j] == convId) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        userConversationIds[newOwner].push(convId);
      }
    }

    // Transfer all approval requests where msg.sender is the requestor
    address[] memory approvers = requestorApprovers[msg.sender];
    for (uint256 i = 0; i < approvers.length; i++) {
      address approver = approvers[i];

      // Transfer all requests from this approver
      ApprovalRequest[] memory requests = approvalRequests[approver][msg.sender];
      for (uint256 j = 0; j < requests.length; j++) {
        approvalRequests[approver][newOwner].push(requests[j]);
      }

      // Update the approver's requestor list
      address[] storage requestors = approverRequestors[approver];
      bool newOwnerExists = false;

      // Check if newOwner is already in the list
      for (uint256 k = 0; k < requestors.length; k++) {
        if (requestors[k] == newOwner) {
          newOwnerExists = true;
        }
      }

      // Remove msg.sender from requestors list
      for (uint256 k = 0; k < requestors.length; k++) {
        if (requestors[k] == msg.sender) {
          requestors[k] = requestors[requestors.length - 1];
          requestors.pop();
          break;
        }
      }

      // Add newOwner if not present
      if (!newOwnerExists) {
        approverRequestors[approver].push(newOwner);
      }

      // Add approver to newOwner's approver list
      bool approverExistsForNewOwner = false;
      address[] storage newOwnerApprovers = requestorApprovers[newOwner];
      for (uint256 k = 0; k < newOwnerApprovers.length; k++) {
        if (newOwnerApprovers[k] == approver) {
          approverExistsForNewOwner = true;
          break;
        }
      }
      if (!approverExistsForNewOwner) {
        requestorApprovers[newOwner].push(approver);
      }

      delete approvalRequests[approver][msg.sender];
    }

    // Clear old owner's data
    delete posts[msg.sender];
    delete addressPublicKeys[msg.sender];
    delete userConversationIds[msg.sender];
    delete requestorApprovers[msg.sender];

    emit OwnershipTransferred(msg.sender, newOwner, block.timestamp);
  }

  /**
   * @dev Adds an address to a named whitelist
   * @param listName The name of the list (e.g., "domain::wiki.rootz.global")
   * @param addressToAdd The address to add
   * @param name The display name for the address
   * @param role The role (0-4). 255 = don't set (use default 0)
   * @param meta The metadata JSON string
   */
  function addToWhitelist(
    string memory listName,
    address addressToAdd,
    string memory name,
    uint8 role,
    string memory meta
  ) external {
    require(bytes(listName).length > 0, "List name cannot be empty");
    require(addressToAdd != address(0), "Address cannot be zero");
    require(role <= 4 || role == 255, "Invalid role: must be 0-4 or 255 (unset)");

    // Check if address is already in the list
    WhitelistEntry[] storage wl = namedWhitelists[msg.sender][listName];
    for (uint256 i = 0; i < wl.length; i++) {
      require(wl[i].addr != addressToAdd, "Address already in whitelist");
    }

    // Track list name for this owner if not already tracked
    if (wl.length == 0) {
      ownerListNames[msg.sender].push(listName);
    }

    uint8 effectiveRole = role == 255 ? 0 : role;

    WhitelistEntry memory entry = WhitelistEntry({
      addr: addressToAdd,
      name: name,
      role: effectiveRole,
      meta: meta
    });

    wl.push(entry);

    // Track membership for reverse lookup
    memberMemberships[msg.sender][addressToAdd].push(MembershipEntry({
      listName: listName,
      role: effectiveRole,
      addedAt: block.timestamp
    }));

    emit WhitelistModified(msg.sender, listName, addressToAdd, "add", block.timestamp);
  }

  /**
   * @dev Removes an address from a named whitelist
   * @param listName The name of the list
   * @param addressToRemove The address to remove
   */
  function removeFromWhitelist(string memory listName, address addressToRemove) external {
    require(bytes(listName).length > 0, "List name cannot be empty");

    WhitelistEntry[] storage wl = namedWhitelists[msg.sender][listName];
    for (uint256 i = 0; i < wl.length; i++) {
      if (wl[i].addr == addressToRemove) {
        wl[i] = wl[wl.length - 1];
        wl.pop();

        // Also remove from membership tracking
        MembershipEntry[] storage memberships = memberMemberships[msg.sender][addressToRemove];
        for (uint256 j = 0; j < memberships.length; j++) {
          if (keccak256(bytes(memberships[j].listName)) == keccak256(bytes(listName))) {
            memberships[j] = memberships[memberships.length - 1];
            memberships.pop();
            break;
          }
        }

        emit WhitelistModified(msg.sender, listName, addressToRemove, "remove", block.timestamp);
        break;
      }
    }
  }

  /**
   * @dev Updates an existing whitelist entry
   * @param listName The name of the list
   * @param addressToUpdate The address to update
   * @param name New name (use "\x00KEEP" to keep existing)
   * @param role New role (use 255 to keep existing)
   * @param meta New metadata (use "\x00KEEP" to keep existing)
   */
  function updateWhitelistEntry(
    string memory listName,
    address addressToUpdate,
    string memory name,
    uint8 role,
    string memory meta
  ) external {
    require(bytes(listName).length > 0, "List name cannot be empty");
    require(role <= 4 || role == 255, "Invalid role: must be 0-4 or 255 (keep existing)");

    WhitelistEntry[] storage wl = namedWhitelists[msg.sender][listName];
    for (uint256 i = 0; i < wl.length; i++) {
      if (wl[i].addr == addressToUpdate) {
        if (keccak256(bytes(name)) != keccak256(bytes("\x00KEEP"))) {
          wl[i].name = name;
        }
        if (role != 255) {
          wl[i].role = role;
        }
        if (keccak256(bytes(meta)) != keccak256(bytes("\x00KEEP"))) {
          wl[i].meta = meta;
        }

        emit WhitelistModified(msg.sender, listName, addressToUpdate, "update", block.timestamp);
        break;
      }
    }
  }

  /**
   * @dev Gets all entries from a named whitelist
   * @param wallet The owner of the list
   * @param listName The name of the list
   * @return Array of whitelist entries
   */
  function getWhitelist(address wallet, string memory listName) external view returns (WhitelistEntry[] memory) {
    return namedWhitelists[wallet][listName];
  }

  /**
   * @dev Gets all list names for an owner
   * @param wallet The owner address
   * @return Array of list names
   */
  function getListNames(address wallet) external view returns (string[] memory) {
    return ownerListNames[wallet];
  }

  /**
   * @dev Checks if an address is in a named whitelist
   * @param wallet The owner of the list
   * @param listName The name of the list
   * @param addressToCheck The address to check
   * @return True if address is in the list
   */
  function isWhitelisted(address wallet, string memory listName, address addressToCheck) external view returns (bool) {
    WhitelistEntry[] memory wl = namedWhitelists[wallet][listName];
    for (uint256 i = 0; i < wl.length; i++) {
      if (wl[i].addr == addressToCheck) {
        return true;
      }
    }
    return false;
  }

  /**
   * @dev Gets a specific whitelist entry
   * @param wallet The owner of the list
   * @param listName The name of the list
   * @param addressToCheck The address to look up
   * @return The whitelist entry
   */
  function getWhitelistEntry(address wallet, string memory listName, address addressToCheck) external view returns (WhitelistEntry memory) {
    WhitelistEntry[] memory wl = namedWhitelists[wallet][listName];
    for (uint256 i = 0; i < wl.length; i++) {
      if (wl[i].addr == addressToCheck) {
        return wl[i];
      }
    }
    revert("Address not in whitelist");
  }

  /**
   * @dev Gets all list memberships for a specific address
   * Returns all lists the member belongs to under the specified owner
   * @param owner The owner of the whitelists
   * @param member The address to look up
   * @return Array of membership entries with list names, roles, and timestamps
   */
  function getListsForMember(address owner, address member) external view returns (MembershipEntry[] memory) {
    return memberMemberships[owner][member];
  }

  /**
   * @dev Creates a request for a file
   * @param approverAddress The address that will approve/deny the request
   * @param fileName The name of the file being requested
   * @param fileHash The hash of the file being requested
   * @param requestDomain The domain context for the request
   */
  function createApproval(address approverAddress, string memory fileName, string memory fileHash, string memory requestDomain) external {
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
          requestor: approver,
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

  // ============================================================================
  // ATTRIBUTE MANAGEMENT
  //
  // Generic key-value storage with public and private namespaces
  // ============================================================================

  /**
   * @dev Add or update an administrator
   * Only the contract sponsor can add administrators
   * @param admin The address to grant admin privileges
   */
  function addAdministrator(address admin) external {
    require(msg.sender == sponsor, "Only sponsor can add administrators");
    require(admin != address(0), "Admin cannot be zero address");
    administrators[admin] = true;
  }

  /**
   * @dev Remove an administrator
   * Only the contract sponsor can remove administrators
   * @param admin The address to revoke admin privileges from
   */
  function removeAdministrator(address admin) external {
    require(msg.sender == sponsor, "Only sponsor can remove administrators");
    administrators[admin] = false;
  }

  /**
   * @dev Check if an address is an administrator
   * @param addr The address to check
   * @return True if the address is an administrator
   */
  function isAdministrator(address addr) external view returns (bool) {
    return addr == sponsor || administrators[addr];
  }

  /**
   * @dev Set a public attribute (readable by anyone)
   * Only sponsor and administrators can set public attributes
   * @param key The attribute key
   * @param value The attribute value
   */
  function setPublicAttribute(string memory key, string memory value) external {
    require(msg.sender == sponsor || administrators[msg.sender], "Only sponsor or administrators can set public attributes");
    require(bytes(key).length > 0, "Key cannot be empty");

    // Track key for enumeration if it's new
    if (bytes(publicAttributes[key]).length == 0) {
      publicAttributeKeys.push(key);
    }

    publicAttributes[key] = value;
    emit AttributeSet(key, true, block.timestamp);
  }

  /**
   * @dev Get a public attribute
   * Anyone can read public attributes
   * @param key The attribute key
   * @return The attribute value
   */
  function getPublicAttribute(string memory key) external view returns (string memory) {
    return publicAttributes[key];
  }

  /**
   * @dev Get all public attribute keys
   * @return Array of all public attribute keys
   */
  function getPublicAttributeKeys() external view returns (string[] memory) {
    return publicAttributeKeys;
  }

  /**
   * @dev Set a private attribute (readable only by sponsor and administrators)
   * Only sponsor and administrators can set private attributes
   * @param key The attribute key
   * @param value The attribute value
   */
  function setPrivateAttribute(string memory key, string memory value) external {
    require(msg.sender == sponsor || administrators[msg.sender], "Only sponsor or administrators can set private attributes");
    require(bytes(key).length > 0, "Key cannot be empty");

    // Track key for enumeration if it's new
    if (bytes(privateAttributes[key]).length == 0) {
      privateAttributeKeys.push(key);
    }

    privateAttributes[key] = value;
    emit AttributeSet(key, false, block.timestamp);
  }

  /**
   * @dev Get a private attribute
   * Only sponsor and administrators can read private attributes
   * @param key The attribute key
   * @return The attribute value
   */
  function getPrivateAttribute(string memory key) external view returns (string memory) {
    require(msg.sender == sponsor || administrators[msg.sender], "Only sponsor or administrators can read private attributes");
    return privateAttributes[key];
  }

  /**
   * @dev Get all private attribute keys
   * Only sponsor and administrators can see private attribute keys
   * @return Array of all private attribute keys
   */
  function getPrivateAttributeKeys() external view returns (string[] memory) {
    require(msg.sender == sponsor || administrators[msg.sender], "Only sponsor or administrators can read private attribute keys");
    return privateAttributeKeys;
  }

  /**
   * @dev Delete a public attribute
   * Only sponsor and administrators can delete public attributes
   * @param key The attribute key to delete
   */
  function deletePublicAttribute(string memory key) external {
    require(msg.sender == sponsor || administrators[msg.sender], "Only sponsor or administrators can delete public attributes");
    delete publicAttributes[key];

    // Remove from keys array
    for (uint256 i = 0; i < publicAttributeKeys.length; i++) {
      if (keccak256(bytes(publicAttributeKeys[i])) == keccak256(bytes(key))) {
        publicAttributeKeys[i] = publicAttributeKeys[publicAttributeKeys.length - 1];
        publicAttributeKeys.pop();
        break;
      }
    }
  }

  /**
   * @dev Delete a private attribute
   * Only sponsor and administrators can delete private attributes
   * @param key The attribute key to delete
   */
  function deletePrivateAttribute(string memory key) external {
    require(msg.sender == sponsor || administrators[msg.sender], "Only sponsor or administrators can delete private attributes");
    delete privateAttributes[key];

    // Remove from keys array
    for (uint256 i = 0; i < privateAttributeKeys.length; i++) {
      if (keccak256(bytes(privateAttributeKeys[i])) == keccak256(bytes(key))) {
        privateAttributeKeys[i] = privateAttributeKeys[privateAttributeKeys.length - 1];
        privateAttributeKeys.pop();
        break;
      }
    }
  }
}
