// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IAddressNaming.sol";

/**
 * @title IUserRegistry
 * @notice Canonical interface for "I am a user registry" — the kind of
 * service that knows which addresses belong to people on this system.
 *
 * Carries IAddressNaming as a base because name resolution is a user-registry
 * responsibility. Adds a single membership predicate; implementations decide
 * what "registered" means in their domain:
 *
 *   - epistery Agent.sol / DomainAgent.sol: addresses listed on any
 *     whitelist / ACL under this contract.
 *   - rootz-v6 UniversalTeamRegistryV4: addresses with a credit account,
 *     authorized factory, or team membership.
 *   - rootz-v6 IdentityContractV3: addresses authorized as rivets on this
 *     identity.
 *
 * Off-chain code that wants to ask "does this system know this address?"
 * holds against this interface and gets a uniform answer.
 */
interface IUserRegistry is IAddressNaming {
    /**
     * @notice True if this registry has a record of the address.
     * "Record" is implementation-defined — membership, identity,
     * credit account, rivet registration, etc.
     * @param addr The address to check
     * @return True if the address is known to this registry
     */
    function isRegistered(address addr) external view returns (bool);
}
