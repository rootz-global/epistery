// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ICreditAccount
 * @notice Canonical interface for credit-bearing user accounts.
 *
 * Signatures match Steven's `UniversalTeamRegistryV4` on Polygon mainnet
 * (`0x83B25fDD25516057AaaAf8027464C8bbb2f91d5B`) so that contract can
 * declare conformance without renaming any existing methods.
 *
 * Implementations decide the conversion between native token (POL/ETH)
 * and credits. UniversalTeamRegistryV4 uses 1 POL = 1,000,000 credits.
 *
 * The user-facing surface is deposit + read. Implementation-private
 * operations (funding specific child contracts like Secrets or KeyVaults,
 * setting rate tables, etc.) are NOT part of this interface — they're
 * authorization-gated internals.
 *
 * Epistery does not yet implement credit accounting. This interface is
 * declared on the epistery side as the cross-system spec; epistery
 * contracts may adopt it later, or epistery-host may delegate credit
 * operations to rootz-v6's deployed Registry.
 */
interface ICreditAccount {
    /**
     * @notice Emitted when credits are added to an account.
     * @param user The user whose balance increased
     * @param amount The credit amount added
     */
    event CreditsDeposited(address indexed user, uint256 amount);

    /**
     * @notice Deposit credits for `user`, paying with native token.
     * The native token amount is `msg.value`; implementations convert
     * to credit units according to their rate table.
     * @param user The account to credit
     * @param amount The credit amount to deposit
     */
    function depositCredits(address user, uint256 amount) external payable;

    /**
     * @notice Read the current credit balance for `user`.
     * @param user The account to read
     * @return The current credit balance
     */
    function getUserCredits(address user) external view returns (uint256);
}
