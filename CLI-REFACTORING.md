# Epistery CLI Refactoring - Final Summary

**Date:** January 10, 2025

## What Changed

Based on your feedback, I refactored the Epistery CLI to use the existing domain configuration system instead of separate wallet files.

### Before (Initial Design)

```bash
# Separate tools, separate wallet files
epistery-auth create my-bot                              # ~/.epistery/my-bot-wallet.json
epistery-auth connect https://wiki.rootz.global my-bot  # Manual connect
epistery-curl -w my-bot https://wiki.rootz.global/...   # Use wallet
```

### After (Domain-Based Design)

```bash
# Unified tool, domain configs (like server)
epistery initialize localhost                    # ~/.epistery/localhost/config.ini
epistery set-default localhost                   # Set in ~/.epistery/config.ini [cli]
epistery curl https://wiki.rootz.global/...      # Auto-connects, uses default
```

## Key Improvements

### 1. Domain-Based Configuration

**Leverages existing Epistery architecture:**
- Each domain gets `~/.epistery/{domain}/config.ini` (same as server)
- Wallet stored in domain config (not separate file)
- Provider configuration per domain
- Sessions saved per domain

**Benefits:**
- ✅ Consistent with server-side model
- ✅ "Domain" = logical identity (can be actual domain or alias like "localhost")
- ✅ Reuses existing Config class and file structure
- ✅ Easy to manage multiple environments

### 2. Default Domain Support

**Added `[cli]` section to `~/.epistery/config.ini`:**

```ini
[cli]
default_domain=localhost
```

**Benefits:**
- ✅ No need to specify `-w` every time
- ✅ Set once with `epistery set-default <domain>`
- ✅ Override when needed with `-w <domain>`

### 3. Automatic Key Exchange

**No manual connect step:**
```bash
# Old way
epistery-auth connect https://server.com my-bot  # Manual step
epistery-curl -w my-bot https://server.com/...

# New way
epistery curl https://server.com/...             # Auto-connects!
```

**How it works:**
1. Check for session in `~/.epistery/{domain}/session.json`
2. If no session, perform key exchange automatically
3. Save session for future requests
4. Make the actual HTTP request

### 4. Unified Command Structure

**Single `epistery` command with subcommands:**

| Subcommand | Purpose |
|------------|---------|
| `initialize <domain>` | Create domain config with wallet |
| `curl [opts] <url>` | Make authenticated HTTP request |
| `info [domain]` | Show domain information |
| `set-default <domain>` | Set default domain |

## Implementation Details

### CliWallet Refactored

**Old approach:**
- `CliWallet.fromFile()` / `saveToFile()`
- Separate wallet JSON files
- Manual wallet management

**New approach:**
- `CliWallet.initialize(domain)` - Creates domain config
- `CliWallet.load(domain)` - Loads from domain config
- `CliWallet.getDefaultDomain()` / `setDefaultDomain()` - Default management
- Uses existing `Config` class from `src/utils/Config.ts`

### File Structure

```
~/.epistery/
├── config.ini                          # Root config
│   ├── [profile]
│   ├── [ipfs]
│   ├── [default.provider]              # Default provider for new domains
│   └── [cli]
│       └── default_domain=localhost    # NEW: Default domain for CLI
│
├── localhost/                           # Domain configs (like server)
│   ├── config.ini                       # Domain wallet & provider
│   └── session.json                     # Session cookie (auto-created)
│
└── wiki.rootz.global/
    ├── config.ini
    └── session.json
```

### Code Changes

**New Files:**
- `cli/epistery.mjs` - Unified CLI tool (replaces epistery-auth.mjs and epistery-curl.mjs)

**Modified Files:**
- `src/utils/CliWallet.ts` - Refactored to use domain configs
- `package.json` - Updated bin to single `epistery` command

**Removed (old design):**
- `cli/epistery-auth.mjs` - Functionality merged into `epistery` subcommands
- `cli/epistery-curl.mjs` - Now `epistery curl`

## Usage Examples

### Basic Workflow

```bash
# Initialize domain (creates wallet in ~/.epistery/localhost/)
epistery initialize localhost

# Set as default
epistery set-default localhost

# Make requests (auto-connects first time)
epistery curl https://wiki.rootz.global/wiki/Home
epistery curl https://wiki.rootz.global/wiki/index

# Check status
epistery info
```

### Multiple Environments

```bash
# Initialize each environment
epistery initialize localhost
epistery initialize staging.example.com
epistery initialize prod.example.com

# Switch between them
epistery curl -w localhost https://localhost:4080/...
epistery curl -w staging.example.com https://staging.example.com/...
epistery curl -w prod.example.com https://prod.example.com/...

# Or use default
epistery set-default prod.example.com
epistery curl https://prod.example.com/...
```

### Bot Mode (No Session)

```bash
# Use --bot flag to sign each request (no session)
epistery curl --bot https://wiki.rootz.global/session/context
```

## Benefits of This Approach

### 1. Conceptual Simplicity
- Domain = Identity (whether localhost, wiki.rootz.global, or any alias)
- Same pattern as server-side Epistery
- No mental overhead of "wallet names" vs "domains"

### 2. Automatic Behavior
- Key exchange happens automatically when needed
- No separate "connect" step to remember
- Session management transparent to user

### 3. Reuses Existing Infrastructure
- `Config` class already handles domain configs
- `Utils.InitServerWallet()` pattern mirrors CLI pattern
- File structure matches server expectations

### 4. Flexibility
- Default domain for convenience
- Override with `-w` when needed
- Both session and bot modes supported
- Multiple domains/environments easy to manage

## Migration from Old Design

If anyone has old wallets from previous design:

```bash
# Old location: ~/.epistery/my-bot-wallet.json
# New approach: Just initialize fresh

epistery initialize my-bot
# This creates: ~/.epistery/my-bot/config.ini with new wallet

# Then copy the address from old wallet.json to register with server admin
```

## Summary

The refactored CLI:
- ✅ Uses Epistery's domain configuration system
- ✅ Provides default domain support
- ✅ Performs automatic key exchange
- ✅ Unified under single `epistery` command
- ✅ Consistent with server-side architecture
- ✅ Simpler for users

This makes Epistery CLI a natural extension of the Epistery domain model, where every identity (whether server or CLI client) is a domain with its own wallet and configuration.

## Next Steps

1. Update Rhonda's wiki-bot to use new `epistery` CLI
2. Document server-side bot authentication requirements
3. Consider adding `epistery list` to show all initialized domains
4. Consider adding `epistery delete <domain>` to remove domains