# Mobile Identity: Platform Restrictions and Strategic Implications

## The Problem

Safari's Intelligent Tracking Prevention (ITP) deletes localStorage and IndexedDB data after 7 days of no user interaction with a site. This policy, introduced in Safari 13.1 (March 2020), is framed as a privacy protection but has significant implications for decentralized identity systems.

Epistery uses non-extractable CryptoKeys stored in IndexedDB to create device-locked wallets ("rivets"). These keys never leave the device and cannot be extracted even via XSS attacks. On iOS Safari, Apple purges these keys after 7 days of inactivity.

## The Security Tradeoff

Because Apple will not allow persistent secure storage, iOS users cannot benefit from the same security model as Android and desktop users.

| Platform | Key Storage | Security Property |
|----------|-------------|-------------------|
| Android/Desktop | Non-extractable CryptoKey in IndexedDB | Private key **never** leaves device, immune to XSS extraction |
| iOS Safari | Extractable key, server-escrowed | Key exists on server (encrypted), theoretically extractable |

This is not a design choice. It is a forced degradation. To maintain continuity for iOS users, Epistery must backup keys to the server, fundamentally weakening the security model.

**Implementation consequence:**

```javascript
const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) &&
                    !window.MSStream &&
                    /Safari/.test(navigator.userAgent);

if (isIOSSafari) {
  // BrowserWallet with server escrow - extractable, less secure
  // Because Apple won't let us keep non-extractable keys
} else {
  // RivetWallet - non-extractable, device-locked, actually private
}
```

## The FIDO/Passkey Double Standard

Apple, Google, and Microsoft control the FIDO Alliance, which develops the WebAuthn/Passkey standards. These passkeys receive special treatment that third-party cryptographic keys do not.

### Storage Comparison

| Credential Type | Where Stored | Subject to ITP? |
|----------------|--------------|-----------------|
| Web Crypto API keys (non-extractable) | IndexedDB | **YES** - purged after 7 days |
| FIDO Passkeys | Secure Enclave + iCloud Keychain | **NO** - OS-level, persists indefinitely |

Both are conceptually "device-bound credentials." Both use hardware security features. The difference is control.

### ITP Scope

From Apple's documentation, ITP targets "script-writable storage":
- localStorage
- IndexedDB
- Cookies set via JavaScript

Passkeys are stored at the OS level (Secure Enclave) and synced via iCloud Keychain. They are explicitly outside the browser sandbox and therefore exempt from ITP purging.

### FIDO Alliance Control

The FIDO Alliance was founded in 2013 and now comprises 250+ members. However, board-level control rests with:
- Google
- Apple
- Microsoft
- Amazon
- Meta

These companies "led development of this expanded set of capabilities and are now building support into their respective platforms." The standard claims decentralization ("PII stays on device"), but the sync mechanism routes through their clouds (iCloud Keychain, Google Account, Microsoft Account).

## The Architecture of Control

1. **Web Crypto API** allows developers to create non-extractable keys that never leave the device
2. **Apple purges these keys** via ITP after 7 days of inactivity
3. **Passkeys** are also device-bound cryptographic credentials
4. **Apple preserves passkeys** indefinitely and syncs them via iCloud

The technical difference? Passkeys live in Apple-controlled infrastructure. Developer-created keys do not.

This is not a privacy measure. It is a competitive moat. The W3C WebAuthn working group has acknowledged this tension - see [Issue #1569: Prevent browsers from deleting credentials that the RP wanted to be server-side](https://github.com/w3c/webauthn/issues/1569).

## Strategic Implications for Epistery

### The Messaging Opportunity

Apple's "privacy" policies force less private implementations:

> "On Android and desktop, your Epistery wallet keys never leave your device. On iOS, Apple's storage policies require server backup, making your keys objectively less secure. Apple claims this is for privacy while their own passkey credentials - also device-bound keys - are exempt and sync through iCloud. The difference is control: they purge your secure keys while preserving theirs."

This is factual, documentable, and inverts Apple's privacy narrative.

### The Multi-Domain Advantage

Epistery's architecture provides some resilience:

- Each publisher domain runs its own Epistery instance (first-party context)
- Chain verification is the shared layer, not browser storage
- There is no single `epistery.com` domain to classify as a tracker
- ITP's cross-site tracking heuristics don't easily apply

### Recovery Mechanisms

The Identity Contract provides a path forward:

1. **First device/site**: Creates invisible rivet, registers on-chain
2. **Additional devices**: Authorized by existing device via multi-sig
3. **Recovery after iOS purge (with other devices live)**: Invisible re-authorization
4. **Recovery with no devices live**: One-time re-affirmation required

Server-set httpOnly cookies (not subject to the same ITP rules as script-writable storage) can bridge the gap by maintaining an encrypted pointer to the user's chain identity.

## FidoWallet Integration

Rather than fight the platform, use its tools. FIDO/WebAuthn credentials persist because Apple blesses them. By integrating FidoWallet as a third wallet type alongside RivetWallet and Web3Wallet, Epistery can leverage platform-blessed persistence while maintaining the on-chain identity as the sovereign anchor.

### Wallet Type Comparison

| Wallet Type | Key Location | Persistence | User Experience | iOS Safari |
|-------------|--------------|-------------|-----------------|------------|
| **RivetWallet** | IndexedDB (non-extractable) | Fragile (ITP purge) | Invisible | Unreliable |
| **Web3Wallet** | MetaMask / external | Persistent | Popup on connect + each sign | Works |
| **FidoWallet** | Secure Enclave | Persistent | One biometric touch | **Reliable** |

### User Experience Flow

**First visit (registration):**
1. User triggers "Secure this device" (prompted or via status page)
2. Single biometric touch (Face ID / Touch ID / fingerprint)
3. WebAuthn credential created, stored in Secure Enclave
4. Epistery stores credential ID + public key server-side, tied to session or chain identity

**Return visit (authentication):**
1. Server sees session cookie, knows user has FIDO credential
2. Requests WebAuthn assertion
3. Single biometric touch
4. Session re-established

**Recovery after iOS purge:**
- Cookie survives (server-set httpOnly, not subject to ITP)
- One touch to re-authenticate
- New rivet created and linked to existing Identity Contract
- Chain state intact, local key reconstructed

### UX Comparison by Scenario

| Scenario | RivetWallet | Web3Wallet | FidoWallet |
|----------|-------------|------------|------------|
| First visit | Invisible | Popup + approve | One touch |
| Return (storage intact) | Invisible | Reconnect popup | Invisible (cookie) |
| Return (storage purged) | **Broken** | Reconnect popup | One touch |
| Sign operation | Invisible | Popup each time | Invisible (rivet signs) |
| iOS Safari | Unreliable | Works (external app) | **Reliable** |

FidoWallet is less intrusive than Web3Wallet while providing the persistence that RivetWallet lacks on iOS.

### The Curve Problem

FIDO uses P-256 (secp256r1). Ethereum uses secp256k1. Direct on-chain signature verification requires reconciliation:

| Approach | Tradeoff |
|----------|----------|
| **Account abstraction (ERC-4337)** | Smart contract wallets can verify P-256, adds complexity |
| **FIDO as auth, rivet for signing** | FIDO proves identity, authorizes secp256k1 rivet for chain ops |
| **PRF-derived key** | Derive secp256k1 from passkey, but extractable |

**Recommended architecture:** FIDO as the persistence/recovery anchor, rivet as the signing key.

This mirrors the Web3Wallet model:
- MetaMask holds keys externally, Epistery requests signatures
- FIDO holds credential externally, Epistery uses it to authorize rivets

The FIDO credential proves "I am this user" to the server. The server trusts the FIDO-authenticated session to authorize rivet keys. Those rivets do the actual chain signing.

### Server Configuration

The epistery host already decides which wallet types to accept. FidoWallet becomes a third option:

```
Wallet types accepted by publisher:
├── RivetWallet  (device-locked, invisible, iOS-fragile)
├── Web3Wallet   (external, persistent, popup-heavy)
└── FidoWallet   (platform-blessed, one-touch, persistent)
```

Server config example: `acceptWallets: ['rivet', 'fido']` or `['fido', 'web3']`

### Status Page Integration

The status page at `/.well-known/epistery/status` already allows users to manage wallet selection. FidoWallet credentials would appear alongside existing options, letting power users manage their constellation of keys across the Identity Contract.

### Strategic Position

Using FIDO means accepting Apple/Google's infrastructure for credential persistence. However:

1. **The FIDO server is independent** - Epistery runs its own relying party, no platform servers in the auth flow
2. **The Identity Contract remains sovereign** - On-chain identity is the anchor, FIDO is a convenience bridge
3. **Users can extricate further** - Add more devices, hardware keys, full self-custody at their own pace
4. **Playing by their rules** - FIDO is an open standard; using it is legitimate, not an exploit

The gesture is heavier than invisible rivet creation, but lighter than MetaMask, and it survives the iOS purge.

## Conclusion

The mobile identity landscape is shaped by platform vendors who have constructed privacy policies that handicap alternatives while exempting their own infrastructure. iOS Safari's localStorage purging is not a neutral privacy measure - it is a selective restriction that degrades third-party security while preserving first-party (Apple-controlled) credential persistence.

Epistery's response:

1. **Document the tradeoff** - iOS users get weaker security, and they should know why
2. **Implement graceful degradation** - Server escrow for iOS, full device-lock for others
3. **Leverage on-chain identity** - The chain is the persistent layer; local storage is reconstructible
4. **Build the coalition** - Every publisher using Epistery has incentive to amplify this message

The monopolies assume identity lives in their silos. Epistery puts identity on-chain, making their storage sabotage an inconvenience rather than a kill switch.

---

## Sources

- [Apple: About the security of passkeys](https://support.apple.com/en-us/102195)
- [Apple: Expanded support for FIDO standard (2022)](https://www.apple.com/newsroom/2022/05/apple-google-and-microsoft-commit-to-expanded-support-for-fido-standard/)
- [FIDO Alliance - Wikipedia](https://en.wikipedia.org/wiki/FIDO_Alliance)
- [W3C WebAuthn Issue #1569: Credential deletion](https://github.com/w3c/webauthn/issues/1569)
- [Corbado: Passkeys & WebAuthn PRF for E2E Encryption](https://www.corbado.com/blog/passkeys-prf-webauthn)
- [Didomi: Apple 7-Day Cap on Script-Writable Storage](https://support.didomi.io/apple-adds-a-7-day-cap-on-all-script-writable-storage)
- [Safari ITP Current Status - cookiestatus.com](https://www.cookiestatus.com/safari/)
