# Epistery Registry

## Overview

The Epistery Registry is a proposed centralized naming system for Epistery identities, analogous to DNS for domain names. It provides a canonical registry for human-readable identity names (e.g., "alice.epistery" or "bob.example.com") and maps them to their corresponding on-chain IdentityContract addresses.

## Problem Statement

Identity contracts need unique, human-readable names within their domain namespaces. While blockchain contracts can verify name uniqueness through on-chain registries, this approach faces several challenges:

1. **Gas Costs** - On-chain name lookups and registration are expensive, especially at scale
2. **Performance** - Querying availability requires blockchain RPC calls with latency
3. **User Experience** - Users expect instant feedback when checking name availability
4. **Scalability** - Large-scale name enumeration on-chain is prohibitively expensive

## Solution: Hybrid Registry Architecture

The Epistery Registry uses a **hybrid approach** combining centralized performance with decentralized verification:

- **Off-chain registry** provides fast lookups and availability checks
- **On-chain proof** ensures ownership and prevents disputes
- **Event-driven sync** keeps registry in sync with blockchain state

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Epistery Registry Server                  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Registry   │  │   Indexer    │  │   HTTP API       │  │
│  │   Database   │  │   Service    │  │   Server         │  │
│  └──────────────┘  └──────────────┘  │                  │  │
│         │                  │          │  /check          │  │
│         │                  │          │  /register       │  │
│         └──────────────────┼─────────→│  /resolve        │  │
│                            │          │  /list           │  │
│                            ↓          └──────────────────┘  │
│                    ┌──────────────┐           ↑             │
│                    │   Event      │           │             │
│                    │   Listener   │           │             │
│                    └──────────────┘           │             │
└────────────────────────────┬───────────────────┼─────────────┘
                             │                   │
                             ↓                   ↓
                    ┌─────────────────┐  ┌──────────────┐
                    │   Blockchain    │  │   Clients    │
                    │   (Polygon)     │  │              │
                    │                 │  │  - Web Apps  │
                    │  Agent Contract │  │  - CLI Tools │
                    │  Identity       │  │  - Wallets   │
                    │  Contracts      │  │              │
                    └─────────────────┘  └──────────────┘
```

### Data Model

#### Registry Database Schema

```sql
-- Names table
CREATE TABLE names (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    full_name VARCHAR(512) GENERATED ALWAYS AS (name || '.' || domain) STORED,
    identity_contract_address VARCHAR(42) NOT NULL,
    owner_address VARCHAR(42) NOT NULL,
    registered_at TIMESTAMP NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    UNIQUE(name, domain)
);

-- Create indexes for fast lookups
CREATE INDEX idx_full_name ON names(full_name);
CREATE INDEX idx_identity_contract ON names(identity_contract_address);
CREATE INDEX idx_owner ON names(owner_address);
CREATE INDEX idx_domain ON names(domain);
```

#### Domain Hierarchy

Names follow a hierarchical structure:
- **TLD (epistery)**: `alice.epistery` - Global Epistery namespace
- **Domain-based**: `bob.example.com` - Attached to specific domains
- **Subdomains**: Reserved for future expansion

### Event Indexing

The registry stays synchronized with blockchain state by listening to contract events:

```javascript
// Listen to IdentityCreated events
agentContract.on('IdentityCreated', async (owner, firstRivet, name, domain, timestamp, event) => {
  if (name && name.length > 0) {
    await registry.registerName({
      name: name,
      domain: domain,
      identityContract: event.address,
      owner: owner,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      timestamp: timestamp
    });
  }
});

// Listen to IdentityNameUpdated events
identityContract.on('IdentityNameUpdated', async (oldName, newName, timestamp, event) => {
  await registry.updateName({
    identityContract: event.address,
    oldName: oldName,
    newName: newName,
    txHash: event.transactionHash,
    blockNumber: event.blockNumber
  });
});
```

## API Endpoints

### `GET /api/registry/check`
Check if a name is available in a domain.

**Query Parameters:**
- `name` - The identity name (required)
- `domain` - The domain (defaults to "epistery")

**Response:**
```json
{
  "available": true,
  "name": "alice",
  "domain": "epistery",
  "fullName": "alice.epistery"
}
```

### `GET /api/registry/resolve`
Resolve a full name to an IdentityContract address.

**Query Parameters:**
- `name` - Full qualified name (e.g., "alice.epistery")

**Response:**
```json
{
  "name": "alice.epistery",
  "identityContract": "0x1234...",
  "owner": "0x5678...",
  "registeredAt": "2025-11-28T12:00:00Z",
  "txHash": "0xabcd...",
  "blockNumber": 12345678
}
```

### `POST /api/registry/register`
Pre-register a name intent (off-chain reservation).

**Request Body:**
```json
{
  "name": "alice",
  "domain": "epistery",
  "ownerAddress": "0x1234..."
}
```

**Response:**
```json
{
  "success": true,
  "reservation": {
    "name": "alice.epistery",
    "expiresAt": "2025-11-28T12:30:00Z",
    "reservationId": "uuid-1234"
  }
}
```

**Note:** Reservation is temporary (30 min) and must be confirmed by on-chain deployment.

### `GET /api/registry/list`
List all names in a domain.

**Query Parameters:**
- `domain` - Domain to list (required)
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 50, max: 500)

**Response:**
```json
{
  "domain": "epistery",
  "total": 1523,
  "page": 1,
  "limit": 50,
  "names": [
    {
      "name": "alice.epistery",
      "identityContract": "0x1234...",
      "registeredAt": "2025-11-20T10:00:00Z"
    },
    // ... more entries
  ]
}
```

## Registration Flow

### 1. Client-Side Registration

```javascript
// Check availability
const available = await fetch('/api/registry/check?name=alice&domain=epistery')
  .then(r => r.json());

if (!available.available) {
  throw new Error('Name already taken');
}

// Reserve name (optional, provides race condition protection)
const reservation = await fetch('/api/registry/register', {
  method: 'POST',
  body: JSON.stringify({
    name: 'alice',
    domain: 'epistery',
    ownerAddress: rivetAddress
  })
}).then(r => r.json());

// Deploy IdentityContract with name
const tx = await factory.deploy('alice', 'epistery');
await tx.wait();

// Registry automatically picks up IdentityCreated event
// Name is now confirmed and reservation is removed
```

### 2. Event-Driven Confirmation

```javascript
// Registry event listener picks up deployment
agentContract.on('IdentityCreated', async (owner, rivet, name, domain) => {
  // Find and confirm reservation
  const reservation = await findReservation(name, domain);
  if (reservation) {
    await confirmReservation(reservation.id);
  }

  // Or create new entry if no reservation exists
  await createNameEntry({
    name: name,
    domain: domain,
    identityContract: tx.contractAddress,
    owner: owner
  });
});
```

## Security Considerations

### Name Squatting Prevention

1. **Reservation System** - Temporary reservations (30 min) prevent front-running
2. **On-Chain Proof** - Only on-chain deployments are authoritative
3. **Event Verification** - All registrations verified against blockchain events
4. **Dispute Resolution** - Blockchain state is always the source of truth

### Race Conditions

**Scenario:** Two users try to register the same name simultaneously.

**Mitigation:**
1. Client checks availability via API (fast feedback)
2. Client creates reservation (locks name for 30 min)
3. Client deploys contract with name
4. First successful on-chain deployment wins
5. Second deployment fails (name already taken on-chain)
6. Failed reservation expires automatically

### Sync Reliability

**Problem:** Registry could get out of sync with blockchain.

**Solutions:**
1. **Event replay** - Periodic full re-sync from blockchain events
2. **Block confirmations** - Wait for N confirmations before considering final
3. **Health checks** - Monitor indexer lag and alert if behind
4. **Manual override** - Admin tools to fix inconsistencies

## Deployment Architecture

### Production Setup

```yaml
# docker-compose.yml
services:
  registry-db:
    image: postgres:15
    volumes:
      - registry-data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: epistery_registry

  registry-api:
    image: epistery/registry:latest
    depends_on:
      - registry-db
    environment:
      DATABASE_URL: postgres://registry-db/epistery_registry
      BLOCKCHAIN_RPC: https://polygon-rpc.com
      AGENT_CONTRACT_ADDRESS: 0x...

  registry-indexer:
    image: epistery/indexer:latest
    depends_on:
      - registry-db
    environment:
      DATABASE_URL: postgres://registry-db/epistery_registry
      BLOCKCHAIN_RPC: https://polygon-rpc.com
      START_BLOCK: 45000000  # Deploy block
```

### High Availability

- **Multi-region deployment** - Reduce latency worldwide
- **Read replicas** - Scale read operations
- **CDN caching** - Cache frequently accessed names
- **Fallback to RPC** - Direct blockchain queries if registry unavailable

## Governance

### Name Policy

1. **Length** - Minimum 3 characters, maximum 32 characters
2. **Characters** - Alphanumeric and hyphens only (a-z, 0-9, -)
3. **Reserved names** - System reserves: admin, root, system, etc.
4. **Profanity filter** - Optional content moderation

### Domain Management

Each domain can set its own policies:
- **Public registration** - Anyone can register (e.g., "epistery")
- **Whitelist only** - Must be on domain whitelist
- **Invite only** - Requires invitation code
- **Custom validation** - Domain-specific name rules

## Future Enhancements

### Decentralization Path

While starting centralized for performance, the registry can evolve:

1. **Federated registries** - Multiple registry operators
2. **Blockchain checkpoints** - Periodic Merkle root commits on-chain
3. **IPFS backup** - Distribute registry snapshots via IPFS
4. **DAO governance** - Community control over policies
5. **ENS integration** - Bridge to Ethereum Name Service

### Advanced Features

- **Name transfers** - Transfer name to new IdentityContract
- **Aliases** - Multiple names pointing to same identity
- **Reverse lookup** - Contract address → names
- **Search** - Full-text search across names and metadata
- **Analytics** - Registration trends, popular names
- **Notifications** - Alert when watched names become available

## Implementation Priority

**Phase 1: MVP** (Immediate)
- Basic PostgreSQL database
- Event indexer for IdentityCreated
- Simple HTTP API (check, resolve, list)

**Phase 2: Production** (Next)
- Reservation system
- Multi-domain support
- Monitoring and alerts
- Performance optimization

**Phase 3: Scale** (Future)
- High availability setup
- CDN integration
- Advanced search
- Federation support

## Conclusion

The Epistery Registry provides a pragmatic solution to identity naming by combining the speed and convenience of centralized systems with the security and verifiability of blockchain. This hybrid approach delivers the best user experience while maintaining the trust properties of decentralized infrastructure.

The registry serves as a **discovery layer** rather than an authority—the blockchain remains the ultimate source of truth, and all registry data can be independently verified by querying contract events directly.
