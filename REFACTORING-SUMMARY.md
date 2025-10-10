# Epistery CLI Authentication Refactoring - Session Summary

**Date:** January 10, 2025
**Session Goal:** Refactor authentication so Epistery provides core functionality for establishing trust between Epistery instances (client/server or server/server) by exchanging validated wallet addresses.

## Background

Prior to this refactoring:
- Bot authentication logic was embedded in Rhonda (host application)
- No reusable CLI authentication for Epistery ecosystem
- Each application would need to implement its own bot auth

## Objective

Create a generic, reusable authentication system in Epistery that:
1. Works for CLI/bot contexts (not just browsers)
2. Enables any Epistery-enabled app to support programmatic access
3. Provides a `curl`-like tool for authenticated requests
4. Maintains stateless design (Epistery has no state)

## What Was Built

### 1. Core Library: CliWallet (`epistery/src/utils/CliWallet.ts`)

**Purpose:** Wallet management for CLI/bot contexts

**Features:**
- Load/save wallets to `~/.epistery/{name}-wallet.json`
- Sign messages for authentication
- Perform key exchange with Epistery servers
- Generate bot authentication headers
- Verify server identity

**Key Methods:**
```typescript
CliWallet.create()                          // Create new wallet
CliWallet.fromFile(path)                    // Load from file
CliWallet.fromDefaultPath(name)             // Load from ~/.epistery/
wallet.sign(message)                        // Sign a message
wallet.performKeyExchange(url)              // Connect to server
wallet.createBotAuthHeader()                // For bot auth mode
```

### 2. CLI Tool: epistery-auth (`epistery/cli/epistery-auth.mjs`)

**Purpose:** Wallet and session management

**Commands:**
```bash
epistery-auth create <name>           # Create new wallet
epistery-auth connect <url> [name]    # Perform key exchange
epistery-auth info [name]             # Show wallet info
epistery-auth bot-header [name]       # Generate auth header
```

**What it does:**
- Creates and manages wallet files
- Performs Epistery key exchange protocol
- Saves session cookies for reuse
- Provides wallet information

### 3. CLI Tool: epistery-curl (`epistery/cli/epistery-curl.mjs`)

**Purpose:** `curl` wrapper with automatic authentication

**Usage:**
```bash
# Session cookie mode (default)
epistery-curl https://wiki.rootz.global/wiki/Home

# Bot authentication header mode
epistery-curl --bot -m GET https://wiki.rootz.global/session/context

# POST with data
epistery-curl -m POST -d '{"title":"Test","body":"# Test"}' <url>
```

**Features:**
- Two authentication modes: session cookie or bot header
- Automatic wallet loading
- Pass-through to `curl` for actual HTTP
- Supports all HTTP methods

### 4. Example Application: wiki-bot-v2.mjs (`rhonda/wiki-bot-v2.mjs`)

**Purpose:** Demonstrates how to use Epistery CLI auth in applications

**Key Pattern:**
```javascript
import { CliWallet } from 'epistery';

const wallet = CliWallet.fromDefaultPath('wiki-bot');
const authHeader = await wallet.createBotAuthHeader();

const response = await fetch(url, {
  headers: { 'Authorization': authHeader }
});
```

## Authentication Modes

### Mode 1: Session Cookie (Default)

**Flow:**
1. User creates wallet: `epistery-auth create my-bot`
2. User connects: `epistery-auth connect https://example.com my-bot`
3. Key exchange happens, session cookie saved
4. Subsequent requests use cookie: `epistery-curl -w my-bot <url>`

**Best for:** Multiple requests to same server, browser-like behavior

### Mode 2: Bot Authentication Header

**Flow:**
1. User creates wallet: `epistery-auth create my-bot`
2. Each request signs a fresh message: `epistery-curl --bot -w my-bot <url>`

**Format:**
```
Authorization: Bot <base64-encoded-json>
```

**Best for:** Distributed systems, stateless requests, when sessions aren't ideal

## Server-Side Changes

### What Stays in Host Apps (e.g., Rhonda)

- User/account management
- Permission/ACL checking
- Bot account registration
- Application-specific logic

### What Epistery Provides

- Wallet-based key exchange protocol
- Signature verification
- Client wallet abstraction (CliWallet)
- CLI tools for authentication

## Key Design Principles

1. **Epistery is stateless** - No database, no sessions stored in Epistery
2. **Protocol-focused** - Epistery defines the key exchange, apps handle authorization
3. **Reusable** - Any app using Epistery can leverage CLI auth
4. **Familiar patterns** - Mirrors browser auth flow
5. **Flexible** - Supports both session and per-request auth modes

## Files Created/Modified

### Created in `epistery/`:
```
src/utils/CliWallet.ts           - Core CLI wallet implementation
cli/epistery-auth.mjs            - Wallet/session management tool
cli/epistery-curl.mjs            - Authenticated curl wrapper
CLI-AUTH.md                      - Comprehensive documentation
REFACTORING-SUMMARY.md           - This file
```

### Modified in `epistery/`:
```
src/utils/index.ts               - Export CliWallet
package.json                     - Add bin entries for CLI tools
```

### Created in `rhonda/`:
```
wiki-bot-v2.mjs                  - Example using Epistery CLI auth
```

### Existing in `rhonda/` (from previous session):
```
modules/account-server/index.mjs - Already has bot auth validation (lines 468-596)
```

## Usage Example: Complete Flow

### Setup (one time):
```bash
# Create wallet
cd epistery
./cli/epistery-auth.mjs create wiki-bot

# Output:
# Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
# Saved to: ~/.epistery/wiki-bot-wallet.json

# Register this address as system account in Rhonda
# (via admin interface or database)

# Connect to establish session
./cli/epistery-auth.mjs connect https://wiki.rootz.global wiki-bot
```

### Using session mode:
```bash
# Make authenticated requests
./cli/epistery-curl.mjs -w wiki-bot https://wiki.rootz.global/wiki/Home
./cli/epistery-curl.mjs -w wiki-bot https://wiki.rootz.global/wiki/index
```

### Using bot mode:
```bash
# No session needed, sign per request
./cli/epistery-curl.mjs --bot -w wiki-bot https://wiki.rootz.global/session/context
```

### In JavaScript:
```javascript
import { CliWallet } from 'epistery';

const wallet = CliWallet.fromDefaultPath('wiki-bot');
const authHeader = await wallet.createBotAuthHeader();

const page = await fetch('https://wiki.rootz.global/wiki/Home', {
  headers: { 'Authorization': authHeader }
});
```

## Benefits

### For Epistery Ecosystem:
- ✅ Consistent auth pattern across all Epistery apps
- ✅ Enables server-to-server authentication
- ✅ Foundation for bot marketplace/ecosystem
- ✅ Reusable tooling (epistery-curl, epistery-auth)

### For Application Developers:
- ✅ No need to implement bot auth from scratch
- ✅ Can focus on app logic, not auth protocol
- ✅ Get CLI tools for free
- ✅ Both browser and bot clients "just work"

### For Bot Developers:
- ✅ Simple `import { CliWallet } from 'epistery'`
- ✅ Standard authentication pattern
- ✅ Choice of session or per-request auth
- ✅ CLI tools for testing/debugging

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Epistery Ecosystem                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────┐         ┌───────────────┐               │
│  │   Browser     │         │   CLI/Bot     │               │
│  │   Client      │         │   Client      │               │
│  │ (Witness.js)  │         │  (CliWallet)  │               │
│  └───────┬───────┘         └───────┬───────┘               │
│          │                         │                         │
│          └─────────┬───────────────┘                         │
│                    │                                         │
│                    │ Key Exchange Protocol                   │
│                    ▼                                         │
│          ┌─────────────────┐                                │
│          │ Epistery Server │                                │
│          │   (index.mjs)   │                                │
│          └────────┬────────┘                                │
│                   │                                          │
│                   │ authentication() callback                │
│                   │ onAuthenticated() callback               │
│                   ▼                                          │
│          ┌─────────────────┐                                │
│          │   Host App      │                                │
│          │  (e.g. Rhonda)  │                                │
│          │  - User lookup  │                                │
│          │  - Permissions  │                                │
│          │  - Bot registry │                                │
│          └─────────────────┘                                │
│                                                               │
└─────────────────────────────────────────────────────────────┘

Tools: epistery-auth, epistery-curl
```

## Security Model

### Trust Establishment:
1. Client proves wallet ownership (signs challenge)
2. Server proves wallet ownership (signs counter-challenge)
3. Both verify each other's signatures
4. Server looks up client wallet in user database
5. Server grants access based on account permissions

### Wallet Security:
- Private keys stored in `~/.epistery/` with 0600 permissions
- Never transmitted over network
- Only signatures are shared
- Users responsible for securing wallet files

### Bot Authentication Header:
- Includes timestamp in message
- Server should validate freshness (TODO: add in Rhonda)
- Prevents replay if timestamp checked
- Each request independently verified

## Future Work

### Near-term (TODOs in code):
- [ ] Add timestamp/nonce validation to prevent replay attacks
- [ ] Consider JWT-based bot tokens as alternative
- [ ] Rate limiting for bot accounts
- [ ] Audit logging for bot actions

### Long-term:
- [ ] Server-to-server authentication (Epistery-to-Epistery)
- [ ] Hardware wallet support for production bots
- [ ] Multi-signature bot accounts
- [ ] Bot permission scopes/fine-grained access
- [ ] Bot marketplace with trust/reputation scores

## Testing

The refactoring is complete and ready for testing:

1. **Build Epistery:**
   ```bash
   cd epistery && npm run build
   ```

2. **Test CLI tools:**
   ```bash
   ./cli/epistery-auth.mjs help
   ./cli/epistery-curl.mjs --help
   ```

3. **Create test wallet:**
   ```bash
   ./cli/epistery-auth.mjs create test-bot
   ```

4. **Connect to wiki:**
   ```bash
   ./cli/epistery-auth.mjs connect https://wiki.rootz.global test-bot
   ```

5. **Make request:**
   ```bash
   ./cli/epistery-curl.mjs -w test-bot https://wiki.rootz.global/session/context
   ```

## Migration Path

For existing Rhonda bot auth (already implemented in previous session):
- ✅ No changes needed - Rhonda already validates bot auth headers
- ✅ Existing bot wallets can continue working
- ✅ New bots should use `epistery-auth` to create wallets
- ✅ Applications can gradually adopt epistery-curl

## Conclusion

This refactoring successfully moved the core authentication protocol into Epistery, making it reusable across the entire ecosystem. Applications like Rhonda now benefit from standardized CLI authentication without needing to implement it themselves.

The key achievement is **separation of concerns**:
- **Epistery:** Handles wallet-based key exchange and verification
- **Host Apps:** Handle user management, permissions, and application logic
- **Developers:** Get reusable CLI tools and libraries

This establishes the foundation for Epistery's vision: enabling trust between any two Epistery instances through validated wallet addresses.