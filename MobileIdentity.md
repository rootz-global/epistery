# Mobile Identity: Platform Restrictions and Strategic Implications

## The Problem

Safari's Intelligent Tracking Prevention (ITP) deletes localStorage and IndexedDB data after 7 days of no user interaction with a site. This policy, introduced in Safari 13.1 (March 2020), is framed as a privacy protection but has significant implications for decentralized identity systems.

Epistery uses non-extractable CryptoKeys stored in IndexedDB to create device-locked wallets ("rivets"). These keys never leave the device and cannot be extracted even via XSS attacks. On iOS Safari, Apple purges these keys after 7 days of inactivity.

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

This is not a privacy measure. It is a competitive moat. The W3C WebAuthn working group has acknowledged this tension — see [Issue #1569: Prevent browsers from deleting credentials that the RP wanted to be server-side](https://github.com/w3c/webauthn/issues/1569).

## Epistery's Response: PRF-Wraps-Rivet

Rather than fight the platform, use its tools — but do not surrender the threat model.

The WebAuthn **PRF extension** lets a relying party ask a passkey to evaluate a pseudo-random function over a fixed input, producing deterministic output bytes that never leave the device. We use those bytes to derive an AES key that wraps the user's secp256k1 rivet private key. The encrypted blob is stored on the epistery server, indexed by the FIDO credential ID and domain. On unlock, the device performs the FIDO ceremony, the PRF output decrypts the blob in memory, and the rivet signs as usual.

This pattern is already in production in the ReefRootz reference implementation (`skswave/reefrootz`), where it solves the iOS purge problem for an existing user base.

### Components

| Component | Role | Where it lives |
|-----------|------|---------------|
| FIDO credential | Persistent unlock factor | Secure Enclave + iCloud Keychain (OS-managed, ITP-exempt) |
| PRF output | AES-256 key material | Computed on device per ceremony; never persisted, never transmitted |
| secp256k1 rivet keypair | Ethereum-compatible signing key | Generated at registration; private key encrypted before any storage |
| Encrypted blob | AES-GCM(rivet private key, PRF-derived key) | Epistery server, keyed by `(domain, credentialId)` |
| Whitelist entry | Public identity | `WhitelistEntry { addr, name, role, meta }` in the domain's agent contract |

### Registration Ceremony

1. User triggers "Secure this device" on a domain.
2. Browser invokes `navigator.credentials.create()` with the PRF extension; user does Face ID / Touch ID.
3. Client derives the AES-256 key from a domain-constant PRF eval input.
4. Client generates a fresh secp256k1 keypair (the rivet).
5. Client AES-GCM-encrypts the rivet private key with the PRF-derived key.
6. Client posts `{ credentialId, publicKey, rivetAddress, encryptedBlob }` to the epistery server; server stores the blob.
7. The new rivet address is added to a whitelist in the domain's agent contract under the user's existing name (admin-mediated or via auto-approval, depending on domain policy).

The rivet private key only exists in JS memory during the ceremony and is discarded after the blob is uploaded.

### Unlock Ceremony (Including After iOS Purge)

1. User visits a domain. IndexedDB may have been purged; the session cookie or a credential lookup identifies which FIDO credential to use.
2. Browser invokes `navigator.credentials.get()` with the same PRF eval input.
3. Client recovers the AES-256 key on device.
4. Client fetches the encrypted blob from the epistery server.
5. Client AES-GCM-decrypts the blob in memory to recover the secp256k1 private key.
6. Rivet signs the session challenge; key exchange completes as for any other wallet.

After the request completes, the private key is dropped. The next session repeats the ceremony, transparent to the user behind a single biometric touch.

### Threat Model

| Threat | Mitigation |
|--------|------------|
| iOS ITP purges IndexedDB | The encrypted blob lives on the epistery server; the decryption key derives from a credential outside ITP scope |
| Server compromise | The blob is AES-GCM-encrypted with a key the server never sees and cannot derive; without the user's biometric, the blob is inert ciphertext |
| XSS exfiltrates the rivet private key | The key exists in JS memory only during the unlock window. Larger surface than a non-extractable IndexedDB key, but only at the moment of use |
| Lost device | Same as Tier 1 today — another device whitelisted under the same name retains access; admin can re-issue or whitelist a fresh credential |

This sits between the two extremes the previous design framed: stronger than full server-escrow (the server has the blob but not the key), weaker than non-extractable IndexedDB on a device ITP doesn't touch. It is the right tradeoff for iOS specifically, and acceptable as a uniform pattern across platforms for implementation simplicity.

## Tier 1 Identity Integration

Epistery has two identity tiers, and FIDO fits the casual (default) tier:

- **Tier 1 — Domain-scoped named whitelist.** The user's name is recorded in `WhitelistEntry.name` on the domain's agent contract (`contracts/agent.sol`). Multiple device addresses can share the same name; each is a "device of the same person" to the domain. A FIDO-bound rivet on the user's phone is just another whitelisted device under the same name.
- **Tier 2 — Identity Contract.** Per-user contract with `authorizedRivets[]` and multi-sig recovery. Gas-costly. Use when sovereign portability across domains matters.

A FIDO rivet **does not require an Identity Contract**. The casual tier handles the common case: the user has a phone (FIDO-protected rivet) and a desktop (RivetWallet rivet), both whitelisted under the same name on the domains they use. The address-to-name resolver in the auth middleware surfaces the same name for both addresses, so the domain treats them as one person.

## The Curve Problem (Resolved)

FIDO uses P-256 (secp256r1). Ethereum uses secp256k1. Earlier iterations of this design proposed using the FIDO credential directly for chain signing, which would have required ERC-4337 account abstraction or P-256 verifier contracts.

PRF-wraps-rivet sidesteps the problem: PRF derives an AES-256 key (curve-agnostic), and the rivet that signs on-chain is a freshly generated secp256k1 keypair. FIDO never signs chain transactions; it only protects the AES wrap. The curve mismatch dissolves because the FIDO credential and the rivet are decoupled.

## UX Comparison

| Scenario | RivetWallet (IndexedDB) | Web3Wallet (MetaMask) | FidoWallet (PRF-wraps-rivet) |
|----------|------|------|------|
| First visit | Invisible | Popup + approve | One biometric touch |
| Return visit (storage intact) | Invisible | Reconnect popup | One touch per session |
| Return visit (iOS purged storage) | **Broken** | Reconnect popup | One touch (fetches blob) |
| Sign operation | Invisible | Popup each time | Invisible after unlock (rivet signs) |
| iOS Safari reliability | Unreliable | Works (external app) | **Reliable** |

FidoWallet adds a single biometric gesture per session in exchange for surviving ITP purges and avoiding MetaMask's per-signature popups.

## Strategic Position

Using FIDO means accepting Apple/Google's infrastructure for credential persistence. The architecture limits the dependency:

1. **The FIDO server is the epistery host** — no platform servers in the auth path; the relying party is the domain itself.
2. **The on-chain identity remains sovereign** — whitelist entries and (optionally) Identity Contracts are the anchor; FIDO is a local unlock factor.
3. **The PRF output never leaves the device** — Apple's iCloud sync handles the credential, but the AES key the credential produces is computed locally each ceremony.
4. **Users can extricate further** — Tier 2 graduation, hardware tokens, or pure RivetWallet on non-iOS devices remain available.

## The Messaging Opportunity

Apple's "privacy" policies force less private implementations:

> "On Android and desktop, your Epistery wallet keys never leave your device. On iOS, Apple purges those keys after 7 days while their own passkey credentials — also device-bound keys — are preserved indefinitely. We bridge the gap by using their passkeys to protect ours: the AES key that unlocks your wallet is computed by your phone's biometric and never sent to any server, including ours. Apple's purge becomes an inconvenience instead of a kill switch."

This is factual, documentable, and inverts Apple's privacy narrative — while making the right technical choice.

## The Multi-Domain Advantage

Epistery's architecture provides natural resilience:

- Each publisher domain runs its own Epistery instance (first-party context).
- Chain verification is the shared layer, not browser storage.
- There is no single `epistery.com` domain to classify as a tracker.
- ITP's cross-site tracking heuristics don't easily apply.

## Conclusion

The mobile identity landscape is shaped by platform vendors who construct privacy policies that handicap alternatives while exempting their own infrastructure. iOS Safari's localStorage purging is not a neutral privacy measure — it is a selective restriction that degrades third-party security while preserving first-party (Apple-controlled) credential persistence.

Epistery's response:

1. **Use the blessed credential as an unlock factor, not the signing key.** PRF-wraps-rivet preserves Ethereum-compatibility and on-chain sovereignty.
2. **Store the encrypted blob, not the key.** The server holds ciphertext; the decryption material lives in the user's Secure Enclave.
3. **Lean on Tier 1 identity.** Most users don't need an Identity Contract; the domain whitelist with stable names already supports multi-device.
4. **Build the coalition.** Every publisher using Epistery has incentive to amplify this messaging — the technical case and the political case align.

The monopolies assume identity lives in their silos. Epistery puts identity on-chain, makes the local unlock factor opaque to them, and turns their storage sabotage into a routine biometric touch.

---

## Sources

- [Apple: About the security of passkeys](https://support.apple.com/en-us/102195)
- [Apple: Expanded support for FIDO standard (2022)](https://www.apple.com/newsroom/2022/05/apple-google-and-microsoft-commit-to-expanded-support-for-fido-standard/)
- [FIDO Alliance - Wikipedia](https://en.wikipedia.org/wiki/FIDO_Alliance)
- [W3C WebAuthn Issue #1569: Credential deletion](https://github.com/w3c/webauthn/issues/1569)
- [Corbado: Passkeys & WebAuthn PRF for E2E Encryption](https://www.corbado.com/blog/passkeys-prf-webauthn)
- [Didomi: Apple 7-Day Cap on Script-Writable Storage](https://support.didomi.io/apple-adds-a-7-day-cap-on-all-script-writable-storage)
- [Safari ITP Current Status - cookiestatus.com](https://www.cookiestatus.com/safari/)
- ReefRootz reference implementation: `skswave/reefrootz`