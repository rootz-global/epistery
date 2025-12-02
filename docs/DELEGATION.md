# Epistery Delegation System

## Overview

Epistery uses a cryptographic delegation system to authenticate users and authorize actions across its distributed architecture. This system binds together multiple components: Rivet identities, Identity Contracts, and Epistery servers.

## Core Components

### 1. Rivets (Rivet Identities)

A **Rivet** is a cryptographic identity in the Epistery ecosystem. Each Rivet:
- Has a unique address (format: `rivet:...`)
- Is controlled by a private key held in secure hardware (TEE - Trusted Execution Environment)
- Can sign transactions and create delegation tokens
- Can own and control other blockchain assets, including servers

**Important Note**: The term "Rivet" refers to the identity system. **RVT** is a separate cryptocurrency coin (150M minted in 2018) - do not confuse the two.

### 2. Identity Contracts

**Identity Contracts** are on-chain smart contracts that:
- Bind Ethereum addresses to Rivet identities
- Store the mapping between a Rivet and its associated blockchain addresses
- Enable cross-chain identity verification
- Provide a permanent, verifiable record of identity ownership

The Identity Contract allows a Rivet to prove it controls specific Ethereum addresses without revealing the Rivet's private key.

### 3. Epistery Servers

**Epistery Servers** are domain-based hosts that:
- Run at specific domains (e.g., `localhost`, `wiki.rootz.global`)
- Have their own server wallets for blockchain transactions
- Host agents (like white-list, message-board) that provide services
- Verify delegation tokens to authenticate users
- Are owned by Rivets through Identity Contracts

## Delegation Token Structure

A delegation token is a signed credential that proves a Rivet has authorized specific actions on a specific domain. The token has two parts:

### Delegation Object
```json
{
  "issuer": "localhost",           // Domain that issued the token
  "subject": "0x00bf1d...",        // Ethereum address of the user
  "audience": "localhost",          // Domain where token is valid
  "scope": ["whitelist:admin"],    // Permissions granted
  "expires": 1766926706985,        // Unix timestamp when token expires
  "nonce": "7ea5a147-...",         // Unique identifier
  "createdAt": 1764334706985,      // Unix timestamp when created
  "version": "1.0"                 // Protocol version
}
```

### Signature
```json
{
  "signature": "0xd3cf5804...",    // Cryptographic signature
  "publicKey": "0x048f9c30..."     // Public key used to verify signature
}
```

## How Delegation Works

### 1. Token Creation
1. User authenticates with their Rivet (via TEE/secure hardware)
2. Rivet signs a delegation object granting specific permissions
3. Delegation includes the user's Ethereum address (from Identity Contract)
4. Token is stored in browser cookie: `epistery_delegation`

### 2. Token Verification
When a user makes a request to an Epistery agent:

1. **Extract Token**: Agent reads `epistery_delegation` cookie or `x-epistery-delegation` header
2. **Parse**: Parse JSON to get delegation object and signature
3. **Verify Expiration**: Check `expires` timestamp
4. **Verify Audience**: Ensure `audience` matches the current domain
5. **Verify Signature**: Validate signature using provided public key
6. **Extract Identity**: Get user's Ethereum address from `subject` field

### 3. Authorization
After verifying the token, the agent checks permissions:

1. **Check Scope**: Look at `scope` array for claimed permissions
2. **Verify On-Chain**: Query blockchain to confirm user is on required whitelists
   - Example: Check if address is on `epistery::admin` list
   - Example: Check if address is on `message-board::posting` list
3. **Grant Access**: Allow or deny the requested action

## Access Control Layers

Epistery uses multiple layers of access control:

### Layer 1: Named Lists (On-Chain)
Named lists are stored on the blockchain and managed via the white-list agent:
- Format: `namespace::identifier`
- Examples:
  - `epistery::admin` - Domain administrators
  - `domain::localhost` - Users allowed on localhost domain
  - `message-board::posting` - Users who can post on message board
  - `message-board::moderators` - Users who can moderate posts

### Layer 2: Delegation Scope
The delegation token itself contains a `scope` array declaring what permissions the user claims to have. However, **the scope is declarative, not authoritative** - agents must still verify claims against on-chain lists.

### Layer 3: Notabot Points
An additional reputation-based system (not yet fully implemented):
- Users accumulate "notabot points" through verified actions
- Minimum point thresholds can be required for actions
- Provides anti-spam protection without explicit whitelisting
- Falls back gracefully when not implemented

## Server Wallet vs. User Identity

It's critical to understand the distinction:

### User's Rivet Identity
- Proves who the user is
- Used for **authentication** (verifying identity)
- Used for **authorization** (checking permissions)
- Never pays gas fees for server operations

### Server Wallet
- A separate Ethereum wallet owned by the domain
- Used by the server to execute blockchain transactions
- **Pays all gas fees** for on-chain operations (like updating whitelists)
- Initialized per domain (e.g., `domain::localhost` has its own wallet)
- Managed by `Utils.InitServerWallet(domainName)`

**Example**: When an admin adds someone to a whitelist:
1. Admin proves their identity with delegation token
2. Server verifies admin is on `epistery::admin` list
3. Server uses **its own wallet** to call the smart contract
4. Server's wallet pays the gas fee
5. Transaction is recorded on-chain

## Ownership Hierarchy

```
Rivet Identity (rivet:...)
    │
    ├─> Identity Contract (on-chain)
    │       └─> Binds Rivet to Ethereum address(es)
    │
    ├─> Owns Server(s)
    │       └─> Server Wallet (pays gas)
    │       └─> Hosts Agents
    │           ├─> white-list agent
    │           ├─> message-board agent
    │           └─> other agents...
    │
    └─> Creates Delegation Tokens
            └─> Grants scoped permissions on specific domains
```

## Security Model

### What the Server Trusts
1. **Signature Verification**: Cryptographic proof that the delegation was signed by the claimed public key
2. **On-Chain Lists**: Blockchain records are the source of truth for authorization
3. **Expiration**: Tokens are time-limited to reduce risk of stolen tokens

### What the Server Does NOT Trust
1. **Scope Claims**: The `scope` field in delegation is verified against on-chain lists
2. **Client-Side State**: All authorization decisions are made server-side
3. **Cookie Contents**: Delegation tokens are verified cryptographically

### Attack Mitigations
- **Token Theft**: Tokens expire automatically
- **Replay Attacks**: Nonce prevents reuse
- **Audience Mismatch**: Tokens only work on intended domain
- **Scope Escalation**: On-chain verification prevents unauthorized access
- **Man-in-the-Middle**: HTTPS required, signature verification

## Implementation Example

```javascript
// Agent verifies delegation token
async verifyDelegationToken(req) {
  // 1. Extract token from cookie or header
  const tokenData = req.cookies?.epistery_delegation ||
                    req.headers['x-epistery-delegation'];

  // 2. Parse JSON
  const { delegation, signature } = JSON.parse(tokenData);

  // 3. Verify expiration
  if (Date.now() > delegation.expires) {
    return { valid: false, error: 'Token expired' };
  }

  // 4. Verify audience matches current domain
  if (delegation.audience !== req.hostname) {
    return { valid: false, error: 'Token audience mismatch' };
  }

  // 5. Verify signature (TODO: implement full verification)
  // const verified = verifySignature(delegation, signature, publicKey);

  // 6. Return verified identity
  return {
    valid: true,
    rivetAddress: delegation.subject,  // Ethereum address from Identity Contract
    domain: delegation.audience,
    scope: delegation.scope
  };
}

// Agent checks authorization
async checkPostingPermission(req) {
  const verification = await this.verifyDelegationToken(req);

  // Verify on-chain membership
  const isAdmin = await this.epistery.isListed(
    verification.rivetAddress,
    'epistery::admin'
  );

  if (isAdmin) {
    return { allowed: true, method: 'admin' };
  }

  // Check other lists, notabot points, etc.
  // ...
}
```

## Future Enhancements

### Planned
- Full signature verification with Rivet public key
- Cross-domain delegation chains
- Revocation lists for compromised tokens
- Notabot point integration
- Multi-signature delegation for high-value operations

### Under Consideration
- Delegated delegation (re-delegation with reduced scope)
- Time-limited capability tokens
- Biometric binding for high-security operations
- Zero-knowledge proofs for privacy-preserving authorization

## Glossary

- **Rivet**: A cryptographic identity in the Epistery ecosystem (format: `rivet:...`)
- **RVT**: The Rivetz cryptocurrency coin (separate from Rivet identities)
- **Identity Contract**: On-chain smart contract binding Rivets to Ethereum addresses
- **Delegation Token**: Signed credential proving authorization for specific actions
- **Server Wallet**: Ethereum wallet owned by the domain, pays gas fees
- **Named List**: On-chain whitelist/access control list (format: `namespace::identifier`)
- **Scope**: Array of claimed permissions in a delegation token
- **Audience**: The domain where a delegation token is valid
- **Subject**: The user's Ethereum address in a delegation token
- **TEE**: Trusted Execution Environment (secure hardware for key storage)

## References

- [White-List Agent](/home/msprague/workspace/epistery/white-list/index.mjs) - Implementation of on-chain access control
- [Message Board Agent](/home/msprague/workspace/epistery/message-board/index.mjs) - Example of delegation verification
- [Epistery Core](/home/msprague/workspace/epistery/epistery/index.mjs) - Core delegation and identity functionality
