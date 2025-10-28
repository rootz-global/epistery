# Epistery

_Epistemology is the study of knowledge. An Epistery, it follows, is a place to share the knowledge of knowledge._

**Epistery** is blockchain-based middleware that provides websites and applications with decentralized authentication, data ownership verification, and trusted data exchange. It serves as a neutral foundation for web applications to identify users, verify data provenance, and conduct digital business without relying on centralized gatekeepers.

## What Does Epistery Do?

Epistery adds blockchain-backed identity and data wallet capabilities to any Express.js application through a simple plugin architecture. It provides:

- **Decentralized Authentication**: Wallet-based user authentication with automatic key exchange
- **Data Wallets**: Blockchain-anchored data ownership and provenance tracking
- **Whitelist Management**: On-chain access control for domains and users
- **CLI Tools**: Command-line interface for authenticated API requests
- **Client Libraries**: Browser-based wallet and authentication tools

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

Data wallets attach blockchain-based ownership and provenance to any data:

```javascript
// Client creates data wallet
const dataWallet = await client.write({
  title: 'My Document',
  content: 'Document content...',
  metadata: { tags: ['important'] }
});

// Read data wallet
const data = await client.read();

// Transfer ownership
await client.transferOwnership(newOwnerAddress);
```

Data wallets use IPFS for storage by default, with only hashes and ownership records stored on-chain.

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

The Epistery CLI enables authenticated API requests from the command line or automation scripts:

```bash
# Initialize a CLI wallet
epistery initialize localhost
epistery set-default localhost

# Make authenticated GET request
epistery curl https://api.example.com/data

# POST request with data
epistery curl -X POST -d '{"title":"Test"}' https://api.example.com/wiki/Test

# Use specific wallet
epistery curl -w production.example.com https://api.example.com/data
```

Perfect for:
- Testing authenticated endpoints
- Building automation scripts
- Creating bots and agents
- CI/CD integration

See [CLI.md](CLI.md) for complete CLI documentation.

## Configuration

Epistery uses a filesystem-based configuration system stored in `~/.epistery/`:

```
~/.epistery/
├── config.ini                    # Global settings
├── mydomain.com/
│   ├── config.ini                # Domain wallet & provider
│   └── sessions/                 # Session data
└── .ssl/
    └── mydomain.com/             # SSL certificates
```

### Root Config (`~/.epistery/config.ini`)

```ini
[profile]
name=Your Name
email=you@example.com

[ipfs]
url=https://rootz.digital/api/v0

[default.provider]
chainId=420420422
name=polkadot-hub-testnet
rpc=https://testnet-passet-hub-eth-rpc.polkadot.io
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

All endpoints follow RFC 8615 well-known URIs standard for service discovery.

See [Architecture.md](Architecture.md) for detailed architecture documentation.

## Use Cases

- **Decentralized Wikis**: User authentication and content ownership without central accounts
- **API Authentication**: Replace API keys with wallet-based authentication
- **Content Attribution**: Track content provenance and ownership on-chain
- **Access Control**: Manage permissions through blockchain whitelists
- **Bot/Agent Authentication**: Secure automation with wallet-based identity

## Security

- Domain configs stored with 0600 permissions (user-only access)
- Private keys never transmitted (only signatures)
- Each domain has isolated wallet
- Session cookies saved securely per domain
- Key exchange uses ECDH for secure shared secrets

## License

MIT License - see [LICENSE](LICENSE) for details

## Links

- **Homepage**: https://epistery.com
- **Repository**: https://github.com/rootz-global/epistery
- **Documentation**: See [CLI.md](CLI.md), [Architecture.md](Architecture.md), [SESSION.md](SESSION.md)
