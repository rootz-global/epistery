# Epistery CLI

Command-line interface for Epistery authentication and requests.

## Quick Start

```bash
# Initialize a domain (creates wallet in ~/.epistery/{domain}/)
epistery initialize localhost

# Set as default
epistery set-default localhost

# Make authenticated requests (automatic key exchange on first use)
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

Make authenticated HTTP request. Automatically performs key exchange on first use.

**Options:**
- `-w, --wallet <domain>` - Use specific domain (overrides default)
- `-X, --request <method>` - HTTP method (default: GET)
- `-d, --data <data>` - Request body data
- `-H, --header <header>` - Additional headers
- `-b, --bot` - Use bot auth header (default: session cookie)
- `-v, --verbose` - Show detailed output

**Examples:**
```bash
# GET request (uses default domain)
epistery curl https://wiki.rootz.global/wiki/Home

# Use specific domain
epistery curl -w localhost https://localhost:4080/session/context

# POST request
epistery curl -X POST -d '{"title":"Test","body":"# Test"}' https://wiki.rootz.global/wiki/Test

# Bot mode (no session, sign per request)
epistery curl --bot https://wiki.rootz.global/session/context
```

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
│   ├── config.ini                # Domain config with wallet & provider
│   └── session.json              # Session cookie (auto-created)
└── wiki.rootz.global/
    ├── config.ini
    └── session.json
```

### Authentication Modes

**Session Cookie (Default):**
- Performs key exchange once, saves session cookie
- Subsequent requests use cookie
- Best for multiple requests to same server

**Bot Auth Header (`--bot`):**
- Signs each request individually
- No session management
- Best for distributed systems or one-off requests

### Automatic Key Exchange

The `curl` command automatically performs key exchange when needed:

1. Check for existing session in `~/.epistery/{domain}/session.json`
2. If no session, perform key exchange with server
3. Save session cookie for future requests
4. Make the actual HTTP request

No manual "connect" step required!

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

### Session File (`~/.epistery/{domain}/session.json`)

Auto-created by `epistery curl`:

```json
{
  "domain": "https://wiki.rootz.global",
  "cookie": "session_token_here",
  "authenticated": true,
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

## Security

- Domain configs stored with 0600 permissions (user only)
- Private keys never transmitted (only signatures)
- Each domain has its own isolated wallet
- Session cookies saved securely per domain

## Design Philosophy

The Epistery CLI uses a unified command structure with subcommands:
- ✅ Uses existing Epistery domain config system
- ✅ Consistent with server-side architecture
- ✅ Automatic key exchange (no manual connect step)
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

### Bot Mode

```bash
# Bot mode doesn't need session, signs each request
epistery curl --bot https://wiki.rootz.global/session/context
epistery curl --bot -X POST -d '{"title":"Log","body":"# Entry"}' https://wiki.rootz.global/wiki/Log
```

## Troubleshooting

**"Domain not found or has no wallet"**
- Run `epistery initialize <domain>` first

**"Key exchange failed"**
- Check server is running and accessible
- Verify URL is correct
- Use `-v` flag for detailed output

**"Failed to obtain session cookie"**
- Server may not be setting cookies
- Try `--bot` mode instead
- Check server configuration

## Integration

The CLI is designed to work with:
- **Rhonda** - Wiki with Epistery authentication
- **Any Epistery-enabled app** - Just initialize and curl!

Server-side apps should implement bot authentication handler (see Rhonda's account-server for example).