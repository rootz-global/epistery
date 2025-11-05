# Rivet Key Delegation

Rivet keys provide **Web3 wallet-blessed, popup-free signing** for Epistery applications. A "rivet key" is a non-extractable browser keypair that is certified by a Web3 wallet (like MetaMask), enabling seamless user experience while maintaining security.

## Concept

The rivet key creates a cryptographic relationship between three parties:

1. **User's Web3 Wallet** (MetaMask) - Ultimate authority, used once for delegation
2. **Browser Rivet Key** (non-extractable) - Certified by wallet, handles routine operations
3. **Server** - Verifies the chain of trust without MetaMask access

This pattern provides:
- ✅ **One-time authorization** - User approves delegation once via MetaMask
- ✅ **Popup-free signing** - All subsequent operations are seamless
- ✅ **Non-extractable security** - Site JavaScript cannot steal the rivet private key
- ✅ **Domain-scoped** - Certificate explicitly limits to one domain
- ✅ **Time-limited** - Expires automatically (can be renewed)
- ✅ **Provable chain** - Server verifies: rivet sig → certificate → wallet

## Architecture

```
┌─────────────────┐
│  MetaMask       │  Signs delegation certificate (ONE popup)
│  Wallet         │  ↓
└─────────────────┘
                     Certificate includes:
                     - Rivet public key
┌─────────────────┐  - Wallet address
│  Browser        │  - Domain
│  Rivet Key      │  - Expiration
│  (P-256 ECDSA)  │  - Permissions
│  Non-extractable│
└─────────────────┘  Signs all requests (NO popups!)
                     ↓
┌─────────────────┐  Verifies:
│  Server         │  1. Certificate signed by wallet
│                 │  2. Certificate not expired
│                 │  3. Domain matches
│                 │  4. Rivet signature valid
└─────────────────┘
```

## Client Usage

### 1. Connect Web3 Wallet

```javascript
// Load the Epistery client library
import { Web3Wallet } from '/.well-known/epistery/lib/wallet.js';
import ethers from '/.well-known/epistery/lib/ethers.js';

// Connect to MetaMask
const wallet = await Web3Wallet.create(ethers);
```

### 2. Delegate to Rivet Key (One-time, requires MetaMask popup)

```javascript
// Delegate for 7 days
const oneWeek = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
const domain = window.location.hostname;

try {
  const rivetData = await wallet.delegateToRivetKey(domain, oneWeek);
  console.log('Rivet key created:', rivetData);
  // User sees ONE MetaMask popup to sign the delegation certificate
} catch (error) {
  console.error('Delegation failed:', error);
}
```

### 3. Sign with Rivet Key (No popups!)

```javascript
// Check if rivet key exists
if (wallet.hasValidRivetKey()) {
  // Sign without MetaMask popup
  const result = await wallet.signWithRivet('authenticate:' + Date.now());

  // Send to server for verification
  const response = await fetch('/.well-known/epistery/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  });

  const data = await response.json();
  console.log('Authenticated:', data);
} else {
  console.log('No valid rivet key - need to delegate');
}
```

### 4. Check Rivet Status

```javascript
// Check if valid rivet key exists
const hasRivet = wallet.hasValidRivetKey();
console.log('Has valid rivet key:', hasRivet);

// Get rivet data (if exists)
const rivetData = JSON.parse(localStorage.getItem('epistery_rivet'));
if (rivetData) {
  const expiresIn = rivetData.certificate.expiresAt - Math.floor(Date.now() / 1000);
  console.log('Rivet expires in:', expiresIn, 'seconds');
}
```

### 5. Revoke Rivet Key

```javascript
// Revoke immediately
wallet.revokeRivetKey();
console.log('Rivet key revoked');
```

## Server Usage

### Verify Rivet Signature

```typescript
import { Epistery } from 'epistery';

// In your route handler
app.post('/.well-known/epistery/authenticate', async (req, res) => {
  const payload = req.body;
  const domain = req.hostname;

  // Verify the rivet signature and certificate chain
  const result = await Epistery.verifyRivetSignature(payload, domain);

  if (result.valid) {
    // Success! Wallet is authenticated
    console.log('Authenticated wallet:', result.walletAddress);

    res.json({
      authenticated: true,
      walletAddress: result.walletAddress,
      timestamp: new Date().toISOString()
    });
  } else {
    // Verification failed
    console.error('Authentication failed:', result.error);

    res.status(401).json({
      authenticated: false,
      error: result.error
    });
  }
});
```

### Understanding the Payload

The `signWithRivet()` method returns this structure:

```javascript
{
  message: "authenticate:1234567890",           // Original message
  rivetSignature: "0x...",                      // Signature by rivet key (P-256)
  certificate: {                                 // Delegation certificate
    rivetPublicKey: "0x...",                    // Rivet public key (P-256 SPKI)
    walletAddress: "0x...",                     // MetaMask wallet address
    domain: "example.com",                       // Authorized domain
    issuedAt: 1234567890,                       // Unix timestamp
    expiresAt: 1234971890,                      // Unix timestamp
    permissions: ["sign", "authenticate"],       // Granted permissions
    version: 1                                   // Certificate version
  },
  certificateSignature: "0x...",                // MetaMask signature on certificate
  walletAddress: "0x..."                        // MetaMask wallet address
}
```

### Server Verification Process

The `Epistery.verifyRivetSignature()` method performs these checks:

1. **Certificate Authenticity**: Verifies MetaMask signed the certificate
2. **Expiration**: Checks certificate hasn't expired
3. **Domain Binding**: Ensures certificate is for the correct domain
4. **Signature Validity**: Verifies rivet key signed the message using P-256 ECDSA

All checks must pass for authentication to succeed.

## Security Considerations

### What Makes This Secure?

1. **Non-extractable Keys**: Browser's SubtleCrypto API prevents JavaScript from reading the rivet private key
2. **Certificate Chain**: Server can verify delegation without MetaMask access
3. **Domain Scoping**: Certificate is bound to specific domain
4. **Time Limits**: Delegation expires automatically
5. **Explicit Authorization**: User approves delegation via MetaMask popup

### What Could Go Wrong?

1. **localStorage Cleared**: Rivet data lost, user needs to re-delegate (one popup)
2. **IndexedDB Cleared**: Rivet key lost, user needs to re-delegate (one popup)
3. **Certificate Stolen**: Attacker can't sign without the non-extractable rivet key
4. **XSS Attack**: Attacker can use rivet key but can't extract it or use it on other domains

### Best Practices

1. **Short Expiration**: Use 7-30 days for delegation expiration
2. **Check Expiration**: Always verify `hasValidRivetKey()` before using
3. **Re-delegate Gracefully**: Prompt user to re-delegate when expired
4. **Revoke on Logout**: Clear rivet key when user logs out
5. **Domain Validation**: Server must verify domain matches certificate

## Use Cases

### Seamless Authentication
```javascript
// Auto-authenticate on page load (no popup!)
if (wallet.hasValidRivetKey()) {
  const auth = await wallet.signWithRivet('auth:' + Date.now());
  await authenticateWithServer(auth);
}
```

### Transaction Signing
```javascript
// Sign transaction data without MetaMask popup
const txData = { from: wallet.address, to: recipient, amount: '1.0' };
const signature = await wallet.signWithRivet(JSON.stringify(txData));
await submitTransaction(txData, signature);
```

### API Authentication
```javascript
// Sign API requests without popups
const apiRequest = {
  endpoint: '/api/data',
  timestamp: Date.now(),
  nonce: crypto.randomUUID()
};
const signature = await wallet.signWithRivet(JSON.stringify(apiRequest));

fetch('/api/data', {
  headers: {
    'X-Rivet-Signature': signature.rivetSignature,
    'X-Rivet-Certificate': JSON.stringify(signature.certificate),
    'X-Certificate-Signature': signature.certificateSignature,
    'X-Wallet-Address': signature.walletAddress
  }
});
```

## Technical Details

### Key Generation

The rivet key uses:
- **Algorithm**: ECDSA
- **Curve**: P-256 (NIST standard, widely supported)
- **Extractable**: false (cannot be read by JavaScript)
- **Storage**: IndexedDB (private key), localStorage (certificate)

### Certificate Format

```typescript
interface RivetCertificate {
  rivetPublicKey: string;      // Hex-encoded SPKI public key
  walletAddress: string;        // Ethereum address
  domain: string;               // Authorized domain
  issuedAt: number;            // Unix timestamp
  expiresAt: number;           // Unix timestamp
  permissions: string[];        // Array of granted permissions
  version: number;             // Certificate version (1)
}
```

### Signature Format

- **Client**: DER-encoded ECDSA signature (P-256 with SHA-256)
- **Transport**: Hex string with '0x' prefix
- **Server**: Verified using Node.js crypto module

## Troubleshooting

### "No rivet key found"
→ Call `delegateToRivetKey()` to create one

### "Rivet key expired"
→ Call `delegateToRivetKey()` again to renew

### "Certificate domain mismatch"
→ Rivet key was created for different domain, need new delegation

### "Certificate not signed by claimed wallet"
→ Certificate data was tampered with, create new delegation

### "Rivet signature invalid"
→ Message was modified after signing, or wrong rivet key used

## Future Enhancements

Potential improvements to the rivet key system:

1. **Hardware-backed keys**: Use WebAuthn for TPM/secure enclave storage
2. **Cross-device sync**: Explore passkey-based rivet key sync
3. **Granular permissions**: More specific permission types
4. **Revocation list**: On-chain revocation registry
5. **Multiple domains**: Single rivet key for multiple domains

## Summary

Rivet keys solve the "MetaMask popup fatigue" problem while maintaining security through:

- Non-extractable browser cryptography
- Web3 wallet-signed delegation certificates
- Domain and time-scoped authorization
- Full verification chain on server

Users get seamless UX after one-time authorization, sites can't steal keys, and servers can verify the complete chain of trust. This is the foundation for building Web3 applications that feel like Web2 while maintaining decentralized security.
