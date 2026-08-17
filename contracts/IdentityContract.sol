// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./EpisteryAccess.sol";

/**
 * @title IdentityContract — a collection of devices that IS an identity
 *
 * A multisig smart wallet whose signers (rivets) are interchangeable owners: any
 * active rivet can act, add/remove rivets, sign as the identity (ERC-1271), and
 * manage the identity's sections. Add a device, lose a device and remove it with
 * another — no seed phrase, no single owner.
 *
 * Access + data for everything the identity owns (sessions, plugin data) uses the
 * common {EpisteryAccess} section mechanism: a session is a section; collaborators
 * are ACL entries on it; a plugin's config/keys are the section's attributes. The
 * rivets are the stewards — implicit role 4 on every section.
 *
 * The **host** is one signer flagged as the default backup/recovery key (e.g.
 * epistery-host). It is a rivet like any other, with no special power, and is fully
 * revocable: `removeRivet(host)` makes the identity 100% self-sovereign. It exists
 * only so a user who still controls a device can be helped to recover — never so a
 * server can broker access.
 *
 * If every server we run vanished, any one rivet + this contract + Storj is enough
 * to read and write all of the identity's data and its collaborators' shared data.
 */
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract IdentityContract is EpisteryAccess, IERC1271 {

    bytes4 constant internal EIP1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 constant internal EIP1271_INVALID = 0xffffffff;

    // ── identity (interchangeable owners = rivets) ─────────────────────────
    address public immutable creator;          // first rivet, for provenance only
    address public host;                        // default recovery signer (a rivet), revocable
    address[] private authorizedRivets;
    mapping(address => bool) public isAuthorized;
    mapping(address => bool) public rivetActive;
    mapping(address => string) public rivetNames;
    mapping(address => uint256) public rivetAddedAt;
    mapping(address => string) public rivetPublicKeys;  // per-device key (communications fabric)
    uint256 public rivetCount;

    uint256 public removeRivetThreshold = 1;    // N-of-M to remove a rivet (governance knob)
    uint256 public messageCount;

    // Reserved section holding the identity's own world-readable profile. The
    // display name lives here as a public attribute ("name") — the on-chain home
    // that replaces the old chat.name KeyVault entry. Anyone can read it; only a
    // steward (rivet) can change it, via setPublic.
    string public constant PROFILE_SECTION = "_profile";

    // ── events ─────────────────────────────────────────────────────────────
    event IdentityCreated(address indexed creator, address indexed host, uint256 timestamp);
    event RivetAdded(address indexed rivet, address indexed addedBy, string name, uint256 timestamp);
    event RivetRemoved(address indexed rivet, address indexed removedBy, uint256 timestamp);
    event HostChanged(address indexed previousHost, address indexed newHost, address indexed by);
    event PublicKeyRegistered(address indexed rivet, string publicKey, uint256 timestamp);
    event TransactionExecuted(address indexed target, uint256 value, address indexed sender, uint256 timestamp);
    event ETHSent(address indexed recipient, uint256 amount, address indexed sender);
    event TokenSent(address indexed token, address indexed recipient, uint256 amount, address indexed sender);
    event RemoveRivetThresholdChanged(uint256 oldThreshold, uint256 newThreshold);
    event MessageReceived(address indexed from, bytes data, uint256 value, uint256 indexed messageIndex, uint256 timestamp);

    /**
     * @param firstRivet the identity's first device (the owner). Not msg.sender, so a
     *        deployer can create it on the user's behalf.
     * @param host_ optional default recovery signer (e.g. epistery-host); pass address(0) for none.
     * @param firstRivetName human name for the first device.
     * @param firstRivetPubKey the device's communications public key (empty for none) —
     *        stored in rivetPublicKeys[firstRivet] so peers can encrypt to it immediately.
     * @param displayName the identity's world-readable display name (empty for none) —
     *        seeded as the "name" public attribute of PROFILE_SECTION.
     *
     * Folding name + pubkey into the constructor makes a mint a single deploy tx:
     * no follow-up setPublic/setPublicKey round-trips.
     */
    constructor(
        address firstRivet,
        address host_,
        string memory firstRivetName,
        string memory firstRivetPubKey,
        string memory displayName
    ) {
        require(firstRivet != address(0), "first rivet required");
        creator = firstRivet;
        _addRivet(firstRivet, bytes(firstRivetName).length > 0 ? firstRivetName : "creator");
        if (bytes(firstRivetPubKey).length > 0) rivetPublicKeys[firstRivet] = firstRivetPubKey;

        if (host_ != address(0) && host_ != firstRivet) {
            _addRivet(host_, "host");
            host = host_;
        }
        if (bytes(displayName).length > 0) _setPublic(PROFILE_SECTION, "name", displayName);
        emit IdentityCreated(firstRivet, host, block.timestamp);
    }

    /** The identity's world-readable display name (PROFILE_SECTION → "name"). */
    function profileName() external view returns (string memory) {
        return _getPublic(PROFILE_SECTION, "name");
    }

    // ── stewardship: the identity itself, and any active rivet, are owners ──
    // `who == address(this)` is load-bearing: the app authorizes callers by
    // their canonical identityAddress, which for an adopted user IS this
    // contract's address (not the raw rivet EOA). So the owner accessing a
    // section on their own IdentityContract arrives as address(this) and must
    // read the top role. Active rivets are stewards too (device-level signing
    // before/without adoption, and cross-contract ERC-1271 proofs).
    function _isSteward(address who) internal view override returns (bool) {
        return who == address(this) || (isAuthorized[who] && rivetActive[who]);
    }

    modifier onlyRivet() {
        require(_isSteward(msg.sender), "caller is not an active rivet");
        _;
    }

    // ── rivet management ────────────────────────────────────────────────────

    function addRivet(address rivet, string memory name) external onlyRivet {
        require(rivet != address(0), "invalid rivet");
        require(!isAuthorized[rivet], "rivet already added");
        require(bytes(name).length > 0, "name required");
        _addRivet(rivet, name);
        emit RivetAdded(rivet, msg.sender, name, block.timestamp);
    }

    function removeRivet(address rivet) external onlyRivet {
        require(isAuthorized[rivet], "rivet not found");
        require(rivetCount > 1, "cannot remove last rivet");
        // (removeRivetThreshold is the intended N-of-M knob; enforcement lands with governance.)

        isAuthorized[rivet] = false;
        rivetActive[rivet] = false;
        rivetCount--;
        delete rivetPublicKeys[rivet];

        // Removing the host is exactly "kick out the host" → self-sovereign.
        if (rivet == host) { emit HostChanged(host, address(0), msg.sender); host = address(0); }

        emit RivetRemoved(rivet, msg.sender, block.timestamp);
    }

    /** Flag an existing rivet as the default recovery host (or clear with address(0)). */
    function designateHost(address newHost) external onlyRivet {
        require(newHost == address(0) || _isSteward(newHost), "host must be an active rivet");
        emit HostChanged(host, newHost, msg.sender);
        host = newHost;
    }

    function setRemoveRivetThreshold(uint256 newThreshold) external onlyRivet {
        require(newThreshold > 0 && newThreshold <= rivetCount, "invalid threshold");
        emit RemoveRivetThresholdChanged(removeRivetThreshold, newThreshold);
        removeRivetThreshold = newThreshold;
    }

    function _addRivet(address rivet, string memory name) private {
        authorizedRivets.push(rivet);
        isAuthorized[rivet] = true;
        rivetActive[rivet] = true;
        rivetNames[rivet] = name;
        rivetAddedAt[rivet] = block.timestamp;
        rivetCount++;
    }

    // ── per-device public key (communications fabric) ──────────────────────

    function setPublicKey(string memory publicKey) external onlyRivet {
        rivetPublicKeys[msg.sender] = publicKey;
        emit PublicKeyRegistered(msg.sender, publicKey, block.timestamp);
    }

    function getRivets() external view returns (address[] memory) {
        address[] memory active = new address[](rivetCount);
        uint256 n;
        for (uint256 i; i < authorizedRivets.length; i++) {
            address r = authorizedRivets[i];
            if (isAuthorized[r] && rivetActive[r]) { active[n++] = r; }
        }
        return active;
    }

    function isRivet(address rivet) external view returns (bool) {
        return isAuthorized[rivet] && rivetActive[rivet];
    }

    // ── act as the identity ─────────────────────────────────────────────────

    function executeTransaction(address target, uint256 value, bytes memory data)
        external payable onlyRivet returns (bool success, bytes memory returnData)
    {
        require(target != address(0), "invalid target");
        require(address(this).balance >= value, "insufficient balance");
        (success, returnData) = target.call{value: value}(data);
        require(success, "transaction failed");
        emit TransactionExecuted(target, value, msg.sender, block.timestamp);
    }

    function sendETH(address payable recipient, uint256 amount) external onlyRivet {
        require(recipient != address(0), "zero recipient");
        require(address(this).balance >= amount, "insufficient balance");
        recipient.transfer(amount);
        emit ETHSent(recipient, amount, msg.sender);
    }

    function sendToken(address token, address recipient, uint256 amount) external onlyRivet {
        require(token != address(0) && recipient != address(0), "zero address");
        require(IERC20(token).transfer(recipient, amount), "token transfer failed");
        emit TokenSent(token, recipient, amount, msg.sender);
    }

    function approveToken(address token, address spender, uint256 amount) external onlyRivet {
        require(token != address(0) && spender != address(0), "zero address");
        require(IERC20(token).approve(spender, amount), "token approval failed");
    }

    function getBalance() external view returns (uint256) { return address(this).balance; }

    // ── ERC-1271: the identity signs when any active rivet signed ──────────

    function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
        require(signature.length == 65, "invalid signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address signer = ecrecover(ethHash, v, r, s);
        return (isAuthorized[signer] && rivetActive[signer]) ? EIP1271_MAGIC_VALUE : EIP1271_INVALID;
    }

    // ── receive value / accept messages ────────────────────────────────────

    receive() external payable {}

    fallback() external payable {
        messageCount++;
        emit MessageReceived(msg.sender, msg.data, msg.value, messageCount, block.timestamp);
    }
}
