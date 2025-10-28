# Epistery Module: Config

**Module:** `epistery/src/utils/Config.ts`
**Export:** `Config`
**Status:** Core Feature
**Version:** 1.0.0

## Overview

The Config module provides a unified, path-based configuration management system for the Epistery ecosystem. It handles domain-specific configurations, SSL certificates, session data, and any other structured data that needs persistent storage.

## Design Philosophy

**Brand-Centric:** User-facing applications own the namespace (`.epistery`), libraries adapt.

**Path-Based:** Configuration navigation works like a filesystem with `setPath()` acting like `cd`.

**Security-First:** Automatic case normalization, recursive directory creation, and permission management.

## API Reference

### Constructor

```typescript
constructor(rootName: string = 'epistery')
```

Creates a new Config instance with the specified root namespace.

**Parameters:**
- `rootName` (optional): Namespace for config directory. Defaults to `'epistery'`.

**File Location:** `~/.{rootName}/`

### Methods

#### `setPath(path: string): void`

Set the current working path (like `cd` in a filesystem).

**Parameters:**
- `path`: Absolute path starting with `/`. Examples: `'/'`, `'/domain'`, `'/.ssl/domain'`

**Behavior:**
- Automatically normalizes to lowercase
- Removes trailing slashes
- Ensures leading slash

```javascript
config.setPath('/wiki.rootz.global');  // → ~/.epistery/wiki.rootz.global/
```

#### `getPath(): string`

Returns the current working path.

#### `load(): void`

Load configuration from `config.ini` at the current path.

**Behavior:**
- Sets `config.data` to the parsed INI content
- If file doesn't exist, sets `config.data` to `{}`

#### `save(): void`

Save `config.data` to `config.ini` at the current path.

**Behavior:**
- Creates directory recursively if it doesn't exist
- Writes INI-formatted data

#### `exists(): boolean`

Check if `config.ini` exists at the current path.

#### `listPaths(): string[]`

List all subdirectories at the current path.

**Returns:** Array of directory names (not full paths).

#### `readFile(filename: string): Buffer`

Read a file from the current path directory.

**Parameters:**
- `filename`: File name (not path)

**Returns:** File contents as Buffer

#### `writeFile(filename: string, data: string | Buffer): void`

Write a file to the current path directory.

**Parameters:**
- `filename`: File name (not path)
- `data`: Content to write

**Behavior:**
- Creates directory recursively if needed

## Usage Examples

### Basic Domain Configuration

```javascript
import { Config } from 'epistery';

const config = new Config();

// Navigate to domain
config.setPath('/wiki.rootz.global');
config.load();

// Modify and save
config.data.verified = true;
config.data.admin_address = '0x...';
config.save();
```

### Multi-Level Paths

```javascript
// SSL certificate storage
config.setPath('/.ssl/wiki.rootz.global');
config.load();
config.data.certData = pemData;
config.data.expiresAt = '2026-01-01';
config.save();

// Also works for arbitrary nesting
config.setPath('/backups/2025/october');
config.save();
```

### File Operations

```javascript
config.setPath('/wiki.rootz.global');

// Write additional files in the domain directory
config.writeFile('private-key.pem', keyData);
config.writeFile('metadata.json', JSON.stringify(metadata));

// Read them back
const key = config.readFile('private-key.pem');
```

### Listing Domains

```javascript
config.setPath('/');
const domains = config.listPaths();
console.log('Configured domains:', domains);
// → ['wiki.rootz.global', 'blackfire.fish', 'localhost']
```

## File Structure

```
~/.epistery/
├── config.ini                    # Root config (path: '/')
├── wiki.rootz.global/
│   ├── config.ini                # Domain config (path: '/wiki.rootz.global')
│   ├── private-key.pem           # Additional files via writeFile()
│   └── sessions/                 # Nested directories
│       └── abc123.json
├── .ssl/
│   └── wiki.rootz.global/
│       └── config.ini            # SSL config (path: '/.ssl/wiki.rootz.global')
```

## Configuration Format

Config uses INI format for human-readable, git-friendly storage:

```ini
[domain]
name=wiki.rootz.global
verified=true
admin_address=0x00bf1d35fa5b3cca18e3900b9e0d46f35d2d5a5d

[provider]
name=Ethereum Mainnet
chainId=1
rpcUrl=https://eth.llamarpc.com

[wallet]
address=0x...
publicKey=0x...
mnemonic=...
```

## Integration with Other Modules

### CliWallet

```javascript
// Initialize domain with wallet
config.setPath('/localhost');
config.data = {
  domain: 'localhost',
  wallet: { /* ... */ },
  provider: { /* ... */ }
};
config.save();
```

### Utils

```javascript
// Initialize server wallet
config.setPath('/domain');
config.load();
if (!config.data.wallet) {
  // Create wallet...
  config.save();
}
```

### Certify (SSL Management)

```javascript
// Store SSL certificates
config.setPath('/.ssl/wiki.rootz.global');
config.data = {
  cert: certPath,
  key: keyPath,
  expiresAt: expiryDate
};
config.save();
```

## Case Normalization

All paths are automatically normalized to lowercase to prevent duplicates on case-sensitive filesystems:

```javascript
config.setPath('/Wiki.Rootz.GLOBAL');
console.log(config.getPath());  // → '/wiki.rootz.global'
```

This prevents the bug where `WIKI.ROOTZ.GLOBAL/` and `wiki.rootz.global/` could both exist.

## Security Considerations

1. **Permissions:** Config files are created with default umask. Sensitive data should use `writeFile()` with explicit permissions.

2. **Path Validation:** Paths are normalized but not validated for directory traversal. Config should only be used with trusted input.

3. **Data Exposure:** Config files in `~/.epistery/` are readable by the user. Don't store unencrypted secrets.

## Library Usage

Libraries that use Config should accept `rootName` as a parameter:

```javascript
// In a reusable library
class MyLibrary {
  constructor(rootName = 'metric') {
    this.config = new Config(rootName);
  }
}

// In an Epistery app
const lib = new MyLibrary('epistery');  // Uses ~/.epistery/
```

This allows libraries to work standalone while integrating cleanly into Epistery apps.

## Migration from Old API

**Old API:**
```javascript
config.loadDomain(domain);
config.data.default.provider;  // Root config
config.domains[domain].verified;  // Domain config
config.saveDomain(domain, domainConfig);
```

**New API:**
```javascript
config.setPath('/');
config.load();
config.data.default.provider;  // Same data

config.setPath(`/${domain}`);
config.load();
config.data.verified;  // Simpler access
config.save();  // Saves to current path
```

## Future Enhancements

1. **Encryption:** Opt-in encryption for sensitive config sections
2. **Validation:** JSON Schema validation for config.data
3. **Versioning:** Automatic config version migration
4. **Sync:** Multi-machine config synchronization via IPFS

## Dependencies

- `fs`: Node.js filesystem operations
- `ini`: INI file parsing/stringifying
- `path`: Path manipulation utilities

## Testing

```bash
npm test -- Config
```

## See Also

- [CliWallet Module](./CliWalletModule.md)
- [Utils Module](./UtilsModule.md)
- [Epistery Configuration Guide](./ConfigurationGuide.md)