# Epistery CLI

Command-line interface for Epistery authentication and requests.

## Quick Start

```bash
# Initialize a domain (creates wallet in ~/.epistery/{domain}/)
epistery initialize localhost

# Set as default
epistery set-default localhost

# Make authenticated requests
epistery curl https://wiki.rootz.global/wiki/Home
```

## Commands

### `epistery initialize <domain>`

Initialize a domain with a new wallet. Creates `~/.epistery/{domain}/config.ini` with:
- Wallet (address, keys, mnemonic)
- Provider configuration (from `~/.epistery/config.ini` default)

```bash
epistery initialize localhost
epistery initialize wiki.rootz.global
```

### `epistery curl [options] <url>`

Make authenticated HTTP requests using bot authentication (signs each request with wallet).

**Options:**
- `-w, --wallet <domain>` - Use specific domain wallet (overrides default)
- `-X, --request <method>` - HTTP method (default: GET)
- `-d, --data <data>` - Request body data (must be quoted JSON string)
- `-H, --header <header>` - Additional headers
- `-v, --verbose` - Show detailed output

**Examples:**
```bash
# GET request (uses default domain)
epistery curl https://wiki.rootz.global/wiki/Home

# Use specific domain wallet
epistery curl -w localhost https://localhost:4080/wiki/Home

# PUT request with JSON data (note single quotes around JSON)
epistery curl -X PUT -d '{"title":"Test","body":"# Test"}' https://wiki.rootz.global/wiki/Test

# POST request
epistery curl -X POST -d '{"name":"value"}' https://api.example.com/endpoint

# Verbose output for debugging
epistery curl -v https://wiki.rootz.global/wiki/Home
```

**Important Notes:**
- Always use **single quotes** around JSON data to prevent shell interpretation
- The CLI uses bot authentication mode (signs each request individually)
- No session management - each request is independently authenticated

### `epistery info [domain]`

Show domain information (wallet address, provider, session status).

```bash
epistery info                # Show default domain
epistery info localhost      # Show specific domain
```

### `epistery set-default <domain>`

Set default domain for CLI operations.

```bash
epistery set-default localhost
```

## Architecture

### Domain-Based Configuration

Epistery CLI uses the same domain configuration system as the server:

```
~/.epistery/
├── config.ini                    # Root config with [cli] section
│   └── [cli]
│       └── default_domain=localhost
├── localhost/
│   └── config.ini                # Domain config with wallet & provider
└── wiki.rootz.global/
    └── config.ini
```

### Authentication

The CLI uses **bot authentication mode**, which signs each request individually with the domain wallet's private key:

1. Load domain wallet from `~/.epistery/{domain}/config.ini`
2. Create authentication message with current timestamp
3. Sign message with wallet's private key
4. Send signature in `Authorization: Bot <base64-encoded-json>` header
5. Server verifies signature and authenticates request

**Benefits:**
- Stateless - no session management needed
- Secure - private keys never leave your machine
- Simple - works immediately after initialization
- Reliable - each request is independently authenticated

## Usage Patterns

### Local Development

```bash
# Initialize for local development
epistery initialize localhost
epistery set-default localhost

# Make requests
epistery curl https://localhost:4080/wiki/index
epistery curl -X PUT -d '{"title":"Test","body":"# Test"}' https://localhost:4080/wiki/Test
```

### Multiple Domains

```bash
# Initialize multiple domains
epistery initialize localhost
epistery initialize wiki.rootz.global
epistery initialize staging.example.com

# Switch between them
epistery curl -w localhost https://localhost:4080/...
epistery curl -w wiki.rootz.global https://wiki.rootz.global/...
epistery curl -w staging.example.com https://staging.example.com/...

# Or set default and omit -w
epistery set-default wiki.rootz.global
epistery curl https://wiki.rootz.global/...
```

### Bot/Agent Applications

```javascript
import { CliWallet } from 'epistery';

// Load domain wallet
const wallet = CliWallet.load('localhost');  // or CliWallet.load() for default

// Create bot auth header
const authHeader = await wallet.createBotAuthHeader();

// Make request
const response = await fetch('https://localhost:4080/wiki/Home', {
  headers: { 'Authorization': authHeader }
});
```

## Configuration Files

### Root Config (`~/.epistery/config.ini`)

```ini
[profile]
name=
email=

[ipfs]
url=https://rootz.digital/api/v0

[default.provider]
chainId=420420422,
name=polkadot-hub-testnet
rpc=https://testnet-passet-hub-eth-rpc.polkadot.io

[cli]
default_domain=localhost
```

### Domain Config (`~/.epistery/{domain}/config.ini`)

```ini
[domain]
domain=localhost

[wallet]
address=0x...
mnemonic=word word word...
publicKey=0x04...
privateKey=0x...

[provider]
chainId=420420422,
name=polkadot-hub-testnet
rpc=https://testnet-passet-hub-eth-rpc.polkadot.io
```

## Security

- Domain configs stored with 0600 permissions (user only)
- Private keys never transmitted (only signatures)
- Each domain has its own isolated wallet
- Each request is signed with fresh timestamp to prevent replay attacks

## Design Philosophy

The Epistery CLI uses a unified command structure with subcommands:
- ✅ Uses existing Epistery domain config system
- ✅ Consistent with server-side architecture
- ✅ Bot authentication (stateless, no session management)
- ✅ Default domain support (less typing)
- ✅ Simpler mental model (domain = wallet)

## Examples

### Initialize and Use

```bash
# Setup
epistery initialize localhost
epistery set-default localhost

# Use
epistery curl https://wiki.rootz.global/wiki/Home
epistery curl https://wiki.rootz.global/wiki/index
```

### Multiple Domains

```bash
# Setup each environment
epistery initialize dev.example.com
epistery initialize staging.example.com
epistery initialize prod.example.com

# Use different environments
epistery curl -w dev.example.com https://dev.example.com/api/status
epistery curl -w staging.example.com https://staging.example.com/api/status
epistery curl -w prod.example.com https://prod.example.com/api/status
```

## Troubleshooting

**"Domain not found or has no wallet"**
- Run `epistery initialize <domain>` first

**401 Unauthorized errors**
- Server may not recognize your wallet address
- Check that your address is authorized on the server
- Use `-v` flag for detailed debugging output

**JSON parsing errors**
- Ensure JSON data is wrapped in **single quotes**: `'{"key":"value"}'`
- Check that JSON is valid (use a JSON validator if needed)

## Integration

The CLI is designed to work with:
- **Rhonda** - Wiki with Epistery authentication
- **Any Epistery-enabled app** - Just initialize and curl!

Server-side apps should implement bot authentication handler (see Rhonda's account-server for example).