# Epistery

_Epistemology is the study of knowledge. An Epistery, it follows, is a place to share the knowledge of knowledge._

**Epistery** is blockchain-based middleware that provides websites and applications with decentralized authentication, data ownership verification, and trusted data exchange. It serves as a neutral foundation for web applications to identify users, verify data provenance, and conduct digital business without relying on centralized gatekeepers.

## What Does Epistery Do?

Epistery establishes a transactional wallet for both browser and server along with the session handshake. This provides:

- **Decentralized Authentication**: Wallet-based user authentication using cryptographic signatures
- **Data Wallets**: Blockchain smart contracts for data ownership, encryption, sharing, and transfer
- **Whitelist Management**: On-chain access control for domains and users
- **CLI Tools**: Command-line interface for authenticated API requests using bot mode
- **Client Libraries**: Browser-based wallet and authentication tools
- **Configuration Management**: Path-based filesystem-like API for secure configuration storage

>*NOTE:* The client wallet (signing key) is held in localStorage under strict domain rules unless the user presents
> a selected wallet from a web3 plugin

## Quick Start

### Installation

```bash
npm install epistery
```

### Server Setup

Initialize a domain to create its blockchain wallet:

```bash
npx epistery initialize mydomain.com
```

Integrate Epistery into your Express application:

```javascript
import express from 'express';
import https from 'https';
import { Epistery } from 'epistery';

const app = express();

// Connect and attach epistery
const epistery = await Epistery.connect();
await epistery.setDomain('mydomain.com');
await epistery.attach(app);

// Optional: Add authentication callback
const episteryWithAuth = await Epistery.connect({
  authentication: async (clientInfo) => {
    // clientInfo.address contains the wallet address
    // Return user profile or null
    return await getUserProfile(clientInfo.address);
  },
  onAuthenticated: async (clientInfo, req, res) => {
    // Called after successful authentication
    console.log('User authenticated:', clientInfo.address);
  }
});

// Start your server
const https_server = https.createServer(epistery.config.SNI, app);
https_server.listen(443);
```

This automatically mounts RFC 8615-compliant routes under `/.well-known/epistery/`:
- `/.well-known/epistery` - Server wallet status (JSON)
- `/.well-known/epistery/status` - Human-readable status page
- `/.well-known/epistery/connect` - Client key exchange endpoint
- `/.well-known/epistery/data/*` - Data wallet operations
- `/.well-known/epistery/whitelist` - Access control endpoints

## Core Features

### 1. Authentication

Epistery provides cryptographic authentication using Ethereum wallets:

**Client-side:**
```javascript
// Load client library in your HTML
<script src="/.well-known/epistery/lib/client.js"></script>
<script>
  const client = new EpisteryClient();
  await client.connect();  // Automatic key exchange
  console.log('Connected as:', client.address);
</script>
```

**Server-side:**
```javascript
// Access authenticated client in routes
app.get('/profile', (req, res) => {
  if (req.episteryClient?.authenticated) {
    res.json({ address: req.episteryClient.address });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});
```

### 2. Data Wallets

Data wallets are blockchain smart contracts that provide ownership, encryption, sharing, and transfer capabilities for any data. They combine on-chain ownership records with off-chain storage:

```javascript
// Client creates data wallet
const dataWallet = await client.write({
  title: 'My Document',
  content: 'Document content...',
  metadata: { tags: ['important'] }
});

// Read data wallet
const data = await client.read();

// Transfer ownership to another address
await client.transferOwnership(newOwnerAddress);
```

**Data Wallet Features:**
- **Blockchain Contracts**: Each data wallet is a smart contract on-chain
- **Encryption**: Data can be encrypted before storage
- **Sharing**: Grant read/write access to specific addresses
- **Transferable**: Ownership can be transferred to other wallets
- **IPFS Storage**: Content stored on IPFS by default, with hashes on-chain
- **Provenance Tracking**: Full ownership and modification history on-chain

### 3. Whitelist Management

Control who can access your domain using on-chain whitelists:

```javascript
// Check if address is whitelisted
const isAllowed = await epistery.isWhitelisted('0x1234...');

// Get full whitelist
const whitelist = await epistery.getWhitelist();
```

Whitelist data is stored on the blockchain and managed through your domain's wallet.

### 4. CLI Tools

The Epistery CLI enables authenticated API requests from the command line using bot authentication (stateless, signs each request):

```bash
# Initialize a CLI wallet
epistery initialize localhost
epistery set-default localhost

# Make authenticated GET request
epistery curl https://api.example.com/data

# PUT request with JSON data (note single quotes)
epistery curl -X PUT -d '{"title":"Test","body":"Content"}' https://api.example.com/wiki/Test

# Use specific wallet
epistery curl -w production.example.com https://api.example.com/data

# Verbose output for debugging
epistery curl -v https://api.example.com/data
```

Perfect for:
- Testing authenticated endpoints
- Building automation scripts
- Creating bots and agents
- CI/CD integration

**CLI uses bot authentication** - each request is independently signed with the wallet's private key, no session management required.

See [CLI.md](CLI.md) for complete CLI documentation.

## Configuration

Epistery uses a path-based configuration system stored in `~/.epistery/` with a filesystem-like API:

```
~/.epistery/
├── config.ini                    # Root config (profile, IPFS, defaults)
├── mydomain.com/
│   └── config.ini                # Domain config (wallet, provider)
└── .ssl/
    └── mydomain.com/             # SSL certificates (optional)
```

### Root Config (`~/.epistery/config.ini`)

```ini
[profile]
name=Your Name
email=you@example.com

[ipfs]
url=https://rootz.digital/api/v0

[cli]
default_domain=localhost

# Which chain the claim-page dropdown selects by default.
[default]
defaultChainId=137

# Private RPC overrides, keyed by chainId. Only needed when the chain's
# built-in public RPC isn't sufficient (rate-limited, needs an API key).
# Everything else — name, public RPC, currency, fee policy — lives in
# the chain classes (src/chains/) and doesn't need to be configured.

[default.rpc.137]
privateRpc=https://polygon-mainnet.infura.io/v3/YOUR_KEY

[default.rpc.1]
privateRpc=https://mainnet.infura.io/v3/YOUR_KEY
```

Legacy single-provider format is also supported:

```ini
[default.provider]
chainId=137
privateRpc=https://polygon-mainnet.infura.io/v3/YOUR_KEY
```

### Domain Config (`~/.epistery/mydomain.com/config.ini`)

```ini
[domain]
domain=mydomain.com

[wallet]
address=0x...
mnemonic=word word word...
publicKey=0x04...
privateKey=0x...

[provider]
chainId=420420422
name=polkadot-hub-testnet
rpc=https://testnet-passet-hub-eth-rpc.polkadot.io
```

The Config class provides a path-based API that works like navigating a filesystem - set a path, load data, modify it, and save. This makes configuration management simple and predictable across all Epistery applications.

## Advanced Usage

### Custom Authentication

Integrate with your existing user system:

```javascript
const epistery = await Epistery.connect({
  authentication: async (clientInfo) => {
    // clientInfo: { address, publicKey }

    // Look up user in your database
    const user = await db.users.findOne({
      walletAddress: clientInfo.address
    });

    if (!user) return null;

    // Return profile data
    return {
      id: user.id,
      username: user.username,
      permissions: user.permissions
    };
  },
  onAuthenticated: async (clientInfo, req, res) => {
    // Called after successful authentication
    // clientInfo includes: address, publicKey, profile, authenticated

    // Set up session, log authentication, etc.
    req.session.userId = clientInfo.profile.id;
  }
});
```

### Configuration Management

Use Epistery's Config class for secure, path-based configuration:

```javascript
import { Config } from 'epistery';

const config = new Config('epistery');

// Navigate filesystem-like paths
config.setPath('/');
config.load();
config.data.profile.email = 'user@example.com';
config.save();

// Domain-specific config
config.setPath('/mydomain.com');
config.load();
config.data.verified = true;
config.save();

// Arbitrary paths
config.setPath('/.ssl/mydomain.com');
config.load();
config.data.certData = '...';
config.save();
```

## Architecture

Epistery follows a plugin architecture that integrates seamlessly with Express.js applications:

- **Server Module** (`/src/epistery.ts`): Core wallet and data wallet operations
- **Client Libraries** (`/client/*.js`): Browser-side authentication and data wallet tools
- **CLI** (`/cli/epistery.mjs`): Command-line interface for authenticated requests
- **Utils** (`/src/utils/`): Configuration, crypto operations, and Aqua protocol implementation
- **Chains** (`/src/chains/`): Per-chain provider, fee policy, and gas estimation

All endpoints follow RFC 8615 well-known URIs standard for service discovery.

See [Architecture.md](Architecture.md) for detailed architecture documentation.

### Chain Support

Each EVM chain epistery talks to is represented by a `Chain` object that owns the JSON-RPC provider, fee policy, gas estimation strategy, and default public RPC. No configuration is needed to use a built-in chain — every detail is in the class itself.

| Chain | ID | Fee Model | Default RPC |
|-------|----|-----------|-------------|
| Polygon Mainnet | 137 | EIP-1559, 25 gwei priority floor | polygon-rpc.com |
| Polygon Amoy | 80002 | EIP-1559, 25 gwei priority floor | rpc-amoy.polygon.technology |
| Ethereum Mainnet | 1 | Standard EIP-1559 | eth.llamarpc.com |
| Sepolia Testnet | 11155111 | Standard EIP-1559 | eth-sepolia.public.blastapi.io |
| Japan Open Chain | 81 | Legacy gasPrice, 30 gwei floor | rpc-2.japanopenchain.org |

Use `chainFor()` to get a chain instance. Only `chainId` is required — everything else comes from the chain class defaults:

```javascript
import { chainFor, registeredChains } from 'epistery';

// Minimal — chain class supplies name, RPC, currency, fee policy
const chain = chainFor({ chainId: 137 });

// Or with an override — privateRpc for server-side calls with an API key
const chain = chainFor({ chainId: 137, privateRpc: 'https://polygon-mainnet.infura.io/v3/KEY' });

// Provider with explicit network info (no "could not detect network" errors)
const wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(chain.provider);

// Per-chain fee data for transaction overrides
const feeData = await chain.getFeeData();
// → Polygon: { maxPriorityFeePerGas: 25 gwei, maxFeePerGas: 50 gwei }
// → JOC:     { gasPrice: 30 gwei }
// → Ethereum: { maxPriorityFeePerGas: <network>, maxFeePerGas: <network> }

// Get the full built-in chain list (for UI dropdowns, etc.)
const chains = registeredChains();
```

Adding a new chain is a single file — extend `Chain`, override the fee hooks that differ, and call `registerChain()`. No edits to existing code. See [src/chains/README.md](src/chains/README.md) for details.

## Use Cases

- **Decentralized Wikis**: User authentication and content ownership without central accounts
- **API Authentication**: Replace API keys with wallet-based authentication
- **Content Attribution**: Track content provenance and ownership on-chain
- **Access Control**: Manage permissions through blockchain whitelists
- **Bot/Agent Authentication**: Secure automation with wallet-based identity

## Security

- **Private Key Protection**: Domain configs stored with 0600 permissions (user-only access)
- **Signature-Only Transmission**: Private keys never transmitted, only cryptographic signatures
- **Wallet Isolation**: Each domain has its own isolated wallet
- **Bot Authentication**: Stateless authentication with per-request signing and timestamp-based replay protection
- **Encrypted Key Exchange**: Browser clients use ECDH for secure shared secret establishment
- **On-Chain Verification**: Whitelist and ownership data stored immutably on blockchain

## Testing

```bash
# Setup test environment (generates wallets automatically)
npm run test:setup

# Run tests
npm test
```

The setup script creates `.test.env` with generated wallet credentials. For integration tests requiring a deployed contract, add `TEST_CONTRACT_ADDRESS` to `.test.env` after running `npm run deploy:agent`.

## License

MIT License - see [LICENSE](LICENSE) for details

## Links

- **Homepage**: https://epistery.com
- **Repository**: https://github.com/rootz-global/epistery
- **Documentation**: See [CLI.md](CLI.md), [Architecture.md](Architecture.md), [SESSION.md](SESSION.md)
