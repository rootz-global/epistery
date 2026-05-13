// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IAddressNaming
 * @notice Canonical interface for resolving identity names from addresses.
 *
 * Names belong to the address itself, not to any (address, list) join.
 * Roles ("owner", "admin", "read", ...) remain on whitelist / ACL entries;
 * names do not. The same address may carry different per-list handles in
 * legacy WhitelistEntry.name fields, but its identity name lives behind
 * this interface.
 *
 * Implementations may be multi-tenant or single-tenant:
 *   - Multi-tenant (e.g. epistery Agent.sol): the read accepts an
 *     ownerAddress scope; writes are keyed by msg.sender.
 *   - Single-tenant (e.g. epistery-host DomainAgent.sol): the read's
 *     ownerAddress argument is accepted on the signature for ABI
 *     compatibility but ignored; writes are admin-gated.
 *
 * Off-chain consumers (e.g. epistery's Utils.ResolveAddressName,
 * Utils.SetAddressName) hold against this interface, so they work
 * uniformly against either implementation without branching on
 * contract type.
 */
interface IAddressNaming {
    /**
     * @notice Set the human-readable name for an address.
     * @param addr The address to name
     * @param name The name string; empty string clears
     */
    function setAddressName(address addr, string memory name) external;

    /**
     * @notice Resolve an address to its name.
     * @param ownerAddress The naming-scope owner; ignored by single-tenant
     *        implementations, used by multi-tenant ones
     * @param addr The address to resolve
     * @return The name, or empty string if unset
     */
    function getAddressName(address ownerAddress, address addr) external view returns (string memory);
}
