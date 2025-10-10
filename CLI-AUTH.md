# Epistery CLI Authentication

This document describes the CLI authentication system added to Epistery, enabling programmatic access to Epistery-enabled applications.

## Overview

Epistery CLI Authentication provides a reusable authentication system for bots, agents, and automated systems. It mirrors the browser-based authentication flow but works in headless/CLI environments.

### Key Components

1. **CliWallet** (`src/utils/CliWallet.ts`) - Core wallet management for CLI contexts
2. **epistery-auth** (`cli/epistery-auth.mjs`) - Wallet and session management CLI
3. **epistery-curl** (`cli/epistery-curl.mjs`) - curl wrapper with automatic authentication

## Architecture

```
┌─────────────────┐
│   Bot/Agent     │
│   Application   │
└────────┬────────┘
         │
         │ uses
         ▼
┌─────────────────┐        ┌──────────────────┐
│   CliWallet     │◄───────│  epistery-auth   │
│  (TypeScript)   │        │   (CLI tool)     │
└────────┬────────┘        └──────────────────┘
         │
         │ performs key exchange
         ▼
┌─────────────────┐        ┌──────────────────┐
│ Epistery Server │◄───────│  epistery-curl   │
│  (Express API)  │        │   (CLI tool)     │
└─────────────────┘        └──────────────────┘
         │
         │ validates with
         ▼
┌─────────────────┐
│  Host App       │
│  (e.g. Rhonda)  │
└─────────────────┘
```

## Authentication Modes

### 1. Session Cookie Mode (Default)

Uses cookies like browser clients. Best for multiple requests to same server.

**Flow:**
1. Create wallet: `epistery-auth create my-bot`
2. Connect to server: `epistery-auth connect https://wiki.rootz.global my-bot`
3. Session cookie saved to `~/.epistery/my-bot-session.txt`
4. Make requests: `epistery-curl -w my-bot <url>`

**Pros:**
- Similar to browser authentication
- Session persists across requests
- Lower overhead per request

**Cons:**
- Requires initial connection step
- Session can expire

### 2. Bot Authentication Header Mode

Signs each request individually. Best for distributed systems or when session cookies aren't ideal.

**Flow:**
1. Create wallet: `epistery-auth create my-bot`
2. Make requests: `epistery-curl --bot -w my-bot <url>`

**Pros:**
- No session management needed
- Works without initial connection
- Each request independently authenticated

**Cons:**
- Sign operation per request
- Slightly higher overhead

## CLI Tools

### epistery-auth

Manages wallets and sessions.

```bash
# Create new wallet
epistery-auth create my-bot

# Connect to server (establish session)
epistery-auth connect https://wiki.rootz.global my-bot

# Show wallet info
epistery-auth info my-bot

# Generate bot authentication header (for debugging)
epistery-auth bot-header my-bot
```

### epistery-curl

Authenticated curl wrapper.

```bash
# GET request with session cookie
epistery-curl https://wiki.rootz.global/wiki/Home

# GET with specific wallet
epistery-curl -w my-bot https://wiki.rootz.global/wiki/index

# POST with bot auth header
epistery-curl --bot -m POST -d '{"title":"Test","body":"# Test"}' \
  https://wiki.rootz.global/wiki/Test

# Verbose mode
epistery-curl -v --bot https://wiki.rootz.global/session/context
```

## Using in Your Application

### JavaScript/Node.js

```javascript
import { CliWallet } from 'epistery';

// Load wallet
const wallet = CliWallet.fromDefaultPath('my-bot');

// Create bot authentication header
const authHeader = await wallet.createBotAuthHeader();

// Make authenticated request
const response = await fetch('https://wiki.rootz.global/wiki/Home', {
  headers: {
    'Authorization': authHeader
  }
});
```

### TypeScript

```typescript
import { CliWallet, CliWalletData } from 'epistery';

const wallet: CliWallet = CliWallet.fromDefaultPath('my-bot');
const authHeader: string = await wallet.createBotAuthHeader();
```

## Server-Side Implementation

To support bot authentication in your Epistery-enabled app:

### 1. Bot Authentication Middleware (Rhonda example)

```javascript
// In authentication middleware
if (req.headers.authorization?.startsWith('Bot ')) {
  const botAuth = await this.validateBotAuth(
    req.headers.authorization.substring(4),
    domain
  );
  if (botAuth) {
    req.account = botAuth;
  }
}

async validateBotAuth(authHeader, domain) {
  // Decode payload
  const decoded = Buffer.from(authHeader, 'base64').toString('utf8');
  const { address, signature, message } = JSON.parse(decoded);

  // Verify signature
  const ethers = await import('ethers');
  const recoveredAddress = ethers.utils.verifyMessage(message, signature);

  if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
    return null;
  }

  // Look up user account
  const userAccount = await this.userCollection.findOne({
    address: address.toLowerCase()
  });

  if (!userAccount) {
    return null;
  }

  // Return account info
  return {
    id: userAccount.accountId,
    userId: userAccount._id,
    address: address.toLowerCase()
  };
}
```

### 2. Register System Accounts

Bot wallets need to be registered as system accounts:

```javascript
// Create system user account
await db.collection('users').insertOne({
  _id: botWalletAddress,
  address: botWalletAddress,
  options: {
    systemAccount: true
  }
});

// Grant account access
await db.collection('acl').insertOne({
  _id: {
    user: botWalletAddress,
    account: rootAccountId
  },
  level: 5  // Appropriate access level
});
```

## Security Considerations

### Wallet Storage

- Wallets stored in `~/.epistery/` with 0600 permissions
- Contains private keys - treat as sensitive
- Consider using hardware wallets for production bots

### Bot Authentication Header

The bot auth header format:
```
Authorization: Bot <base64-encoded-json>
```

Where the JSON contains:
```json
{
  "address": "0x...",
  "signature": "0x...",
  "message": "Rhonda Bot Authentication - 2025-01-10T12:00:00.000Z"
}
```

**Security features:**
- Message includes timestamp to prevent replay attacks (recommended: check timestamp freshness)
- Signature proves ownership of wallet
- Server verifies signature matches address

**TODO improvements:**
- Add nonce/challenge to prevent replay attacks
- Consider JWT-based tokens for bots
- Rate limiting for bot accounts

## Example: Wiki Bot

See `rhonda/wiki-bot-v2.mjs` for a complete example using Epistery CLI auth:

```javascript
import { CliWallet } from 'epistery';

class WikiBot {
  constructor(wallet) {
    this.wallet = wallet;
  }

  async request(method, path, body = null) {
    const authHeader = await this.wallet.createBotAuthHeader();

    const response = await fetch(`${WIKI_URL}${path}`, {
      method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : null
    });

    return await response.json();
  }
}

// Usage
const wallet = CliWallet.fromDefaultPath('wiki-bot');
const bot = new WikiBot(wallet);
const page = await bot.request('GET', '/wiki/Home');
```

## Comparison: Session vs Bot Auth

| Feature | Session Cookie | Bot Auth Header |
|---------|---------------|-----------------|
| Setup | `epistery-auth connect` required | Wallet creation only |
| Per-request overhead | Low (cookie) | Medium (sign) |
| Session management | Yes (expires) | No (stateless) |
| Distributed systems | Harder | Easier |
| Browser similarity | High | Low |
| Security | Tied to session | Per-request proof |

## Wallet File Format

```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "publicKey": "0x04...",
  "privateKey": "0x...",
  "mnemonic": "word word word..."
}
```

## Key Exchange Protocol

Both browser and CLI clients use the same Epistery key exchange:

1. **Client → Server**: Challenge + Signature
```json
{
  "clientAddress": "0x...",
  "clientPublicKey": "0x04...",
  "challenge": "0xrandom...",
  "message": "Epistery Key Exchange - 0x... - 0xrandom...",
  "signature": "0x...",
  "walletSource": "server"
}
```

2. **Server → Client**: Counter-challenge + Signature + Session
```json
{
  "serverAddress": "0x...",
  "serverPublicKey": "0x04...",
  "services": ["data-write", "data-read", ...],
  "challenge": "0xrandom...",
  "signature": "0x...",
  "authenticated": true,
  "profile": {...}
}
```

3. **Client**: Verifies server signature
4. **Server**: Sets session cookie (if applicable)

## Future Enhancements

### Planned
- [ ] JWT-based bot tokens
- [ ] Hardware wallet support
- [ ] Multi-signature bot accounts
- [ ] Bot permission scopes
- [ ] Automatic session refresh
- [ ] Audit logging for bot actions

### Under Consideration
- [ ] OAuth2-like flows for third-party bots
- [ ] Bot marketplace with trust scores
- [ ] Epistery-to-Epistery authentication (server-to-server)
- [ ] Zero-knowledge proof authentication

## Related Files

**Epistery:**
- `src/utils/CliWallet.ts` - Core CLI wallet implementation
- `cli/epistery-auth.mjs` - Wallet/session management
- `cli/epistery-curl.mjs` - Authenticated curl wrapper
- `src/epistery.ts` - Server key exchange handler

**Rhonda:**
- `modules/account-server/index.mjs` - Bot auth validation
- `wiki-bot-v2.mjs` - Example bot using Epistery CLI auth

## Support

For issues or questions about Epistery CLI authentication:
1. Check this documentation
2. Review example implementations
3. Open an issue in the Epistery repository