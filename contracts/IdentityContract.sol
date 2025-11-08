// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IdentityContract
 * @dev Multi-rivet identity contract for binding multiple browser-based wallets (rivets)
 * into a single identity. Implements 1-of-N multisig where any authorized rivet can sign.
 *
 * This contract serves as a unified identity that can be accessed from multiple devices/browsers.
 * Each rivet is a non-extractable browser wallet, and this contract binds them together.
 */
contract IdentityContract {
    // Contract owner (original deployer)
    address public owner;

    // Array of authorized rivet addresses
    address[] private authorizedRivets;

    // Mapping for O(1) lookup of rivet authorization status
    mapping(address => bool) public isAuthorized;

    // Mapping to track when each rivet was added
    mapping(address => uint256) public rivetAddedAt;

    // Mapping to store optional friendly names for rivets
    mapping(address => string) public rivetNames;

    // Events
    event IdentityCreated(address indexed owner, address indexed firstRivet, uint256 timestamp);
    event RivetAdded(address indexed rivet, address indexed addedBy, string name, uint256 timestamp);
    event RivetRemoved(address indexed rivet, address indexed removedBy, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner, uint256 timestamp);

    /**
     * @dev Constructor - initializes the identity contract with the deploying rivet
     * The deploying rivet automatically becomes the owner and first authorized rivet
     */
    constructor() {
        owner = msg.sender;
        authorizedRivets.push(msg.sender);
        isAuthorized[msg.sender] = true;
        rivetAddedAt[msg.sender] = block.timestamp;

        emit IdentityCreated(owner, msg.sender, block.timestamp);
    }

    /**
     * @dev Modifier to restrict access to authorized rivets only
     */
    modifier onlyAuthorized() {
        require(isAuthorized[msg.sender], "Caller is not an authorized rivet");
        _;
    }

    /**
     * @dev Adds a new rivet to the identity with an optional name
     * Can only be called by an already-authorized rivet
     * @param rivet The address of the rivet to add
     * @param name Optional friendly name for the rivet (e.g., "chrome-ubuntu on rhonda.help")
     */
    function addRivet(address rivet, string memory name) external onlyAuthorized {
        require(rivet != address(0), "Rivet address cannot be zero");
        require(!isAuthorized[rivet], "Rivet is already authorized");

        authorizedRivets.push(rivet);
        isAuthorized[rivet] = true;
        rivetAddedAt[rivet] = block.timestamp;
        rivetNames[rivet] = name;

        emit RivetAdded(rivet, msg.sender, name, block.timestamp);
    }

    /**
     * @dev Removes a rivet from the identity
     * Can only be called by an authorized rivet
     * Cannot remove the last rivet (must have at least one)
     * @param rivet The address of the rivet to remove
     */
    function removeRivet(address rivet) external onlyAuthorized {
        require(isAuthorized[rivet], "Rivet is not authorized");
        require(authorizedRivets.length > 1, "Cannot remove the last rivet");

        // Remove from mappings
        isAuthorized[rivet] = false;
        delete rivetAddedAt[rivet];
        delete rivetNames[rivet];

        // Remove from array by swapping with last element and popping
        for (uint256 i = 0; i < authorizedRivets.length; i++) {
            if (authorizedRivets[i] == rivet) {
                authorizedRivets[i] = authorizedRivets[authorizedRivets.length - 1];
                authorizedRivets.pop();
                break;
            }
        }

        emit RivetRemoved(rivet, msg.sender, block.timestamp);
    }

    /**
     * @dev Returns all authorized rivet addresses
     * @return Array of authorized rivet addresses
     */
    function getRivets() external view returns (address[] memory) {
        return authorizedRivets;
    }

    /**
     * @dev Returns all authorized rivet addresses with their names
     * @return addresses Array of rivet addresses
     * @return names Array of rivet names (corresponding to addresses)
     */
    function getRivetsWithNames() external view returns (address[] memory addresses, string[] memory names) {
        addresses = authorizedRivets;
        names = new string[](authorizedRivets.length);

        for (uint256 i = 0; i < authorizedRivets.length; i++) {
            names[i] = rivetNames[authorizedRivets[i]];
        }

        return (addresses, names);
    }

    /**
     * @dev Returns the count of authorized rivets
     * @return Number of authorized rivets
     */
    function getRivetCount() external view returns (uint256) {
        return authorizedRivets.length;
    }

    /**
     * @dev Transfers ownership to a new address
     * Can only be called by current owner
     * @param newOwner The address of the new owner
     */
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "Only owner can transfer ownership");
        require(newOwner != address(0), "New owner cannot be zero address");
        require(newOwner != owner, "Cannot transfer to self");

        address previousOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(previousOwner, newOwner, block.timestamp);
    }

    /**
     * @dev Allows the contract to receive ETH
     * Useful for funding the identity with gas money
     */
    receive() external payable {}

    /**
     * @dev Allows authorized rivets to withdraw ETH from the contract
     * Useful for gas fee management across devices
     * @param amount The amount of ETH to withdraw (in wei)
     */
    function withdraw(uint256 amount) external onlyAuthorized {
        require(address(this).balance >= amount, "Insufficient balance");
        payable(msg.sender).transfer(amount);
    }

    /**
     * @dev Returns the contract's ETH balance
     * @return Balance in wei
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
