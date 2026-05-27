# Epistery

_Epistemology is the study of knowledge. An Epistery, it follows, is a place to share the knowledge of knowledge._

**Epistery is the identity and trust foundation for web applications.** It gives a
host one thing it can trust on every request — a cryptographically proven address —
and the on-chain primitives to decide what that address may do. Everything else
(apps, sessions, content) is built *on top of* epistery and must not re-implement
what epistery owns.

> **Status — under audit (2026-05-27).** This README is the **sealed contract**:
> it defines what epistery is responsible for, what it is not, and its interface.
> Code is held to this document. A dated **[Known divergences](#known-divergences-audit)**
> section at the end lists where the implementation currently fails the contract.
> If behavior and this document disagree, that is a bug in the code, not the doc.

---

## Responsibility (what epistery OWNS)

Epistery is the **single owner** of:

1. **Identity** — proving *who* a request is from. The proof is a wallet signature,
   carried either by a short-lived signed session cookie (`_epistery`, established
   via the `/connect` handshake) or a per-request `Bot` signature. The result is a
   trusted **address** on `req.episteryClient`.
2. **Identity binding** — relating a device key (rivet) to an **IdentityContract**,
   verified on-chain (`isAuthorized`). When bound, epistery presents the *contract*
   as the identity.
3. **Authorization primitive** — on-chain **lists** mapping an address to a numeric
   **role/level**. The host asks "what level is this address?" and gets a number.
4. **Key custody (client)** — generating and protecting the user's signing key in
   the browser (non-extractable, see [Key custody](#identity--key-custody)).
5. **Domain/server wallet & config** — the host's own wallet and the path-based
   `~/.epistery` configuration.

No consumer may bypass, re-derive, or duplicate any of these. In particular: a
downstream service **never** trusts a client-supplied identity header, **never**
re-implements identity resolution, and **never** invents its own ACL when the
on-chain list role already answers the question.

---

## What Epistery DOES

- **Authenticates every request** to a trusted address (`req.episteryClient`), via
  signed session cookie or `Bot` signature.
- **Mints/loads wallets** for browser (rivet / FIDO / web3) and server (per-domain).
- **Binds a device to an IdentityContract** and verifies that binding on-chain.
- **Manages on-chain lists** (address → numeric role) and a name registry
  (address ↔ name).
- **Provides data wallets** — on-chain ownership records with client-signed writes
  and ownership transfer (`/data/*`, prepare→submit-signed pattern).
- **Provides an approval workflow** for access requests (`/approval/*`, `/whitelist/*`).
- **Exposes a CLI** for stateless bot-authenticated requests and admin tasks.
- **Serves client libraries** (`/lib/*`) and contract artifacts (`/artifacts/*`).

## What Epistery does NOT do

- **Does not store application data.** Apps own their storage; epistery records
  ownership/provenance and identity, not your documents.
- **Does not define application- or session-level ACLs.** It provides the
  address→role primitive; consumers *read* a level, they do not build a parallel
  membership system.
- **Does not accept a client's claim of identity.** The only identity is the one
  epistery itself proved (`req.episteryClient`). There is no "I am contract X"
  header. Claims of contract identity are verified on-chain at `/connect`.
- **Does not let downstream code adjudicate auth.** Re-deriving identity or
  re-checking signatures outside epistery is a contract violation.

---

## The trust contract: `req.episteryClient`

The attach middleware sets exactly this on each request (or leaves it `undefined`):

| Field             | Meaning                                                                 |
|-------------------|-------------------------------------------------------------------------|
| `address`         | **The identity.** The IdentityContract address when the wallet is bound; otherwise the rivet (device) address. This is what downstream uses. |
| `signerAddress`   | The rivet that actually signed (the device key). Present when bound.    |
| `contractAddress` | The bound IdentityContract, or `null`.                                  |
| `publicKey`       | The signer's public key.                                                |
| `authenticated`   | Whether the session/handshake completed.                                |
| `authType`        | `"bot"` for `Bot`-signed requests; cookie-based otherwise.              |
| `name`            | Resolved on-chain name, if any (enrichment).                            |
| `notabot*`        | Notabot score enrichment, if available.                                 |

**Rule for consumers:** treat `address` as the principal. The *type* (rivet vs.
contract vs. bot) is available but is rarely your concern. To authorize, resolve a
level for `address` from the active contract's lists.

```javascript
app.get('/thing', (req, res) => {
  const me = req.episteryClient;            // the ONLY source of identity
  if (!me?.authenticated) return res.status(401).end();
  // authorize by level from the on-chain list — do not invent your own ACL
});
```

---

## Identity & key custody

The browser signing key is created and protected by epistery. Custody depends on
wallet type:

| Wallet         | Key custody                                                                                 | Security property |
|----------------|---------------------------------------------------------------------------------------------|-------------------|
| **RivetWallet** (default) | secp256k1 private key **encrypted at rest** by a **non-extractable** AES-GCM `CryptoKey` held in IndexedDB (WebCrypto). Only ciphertext + a key id are persisted. | The signing key cannot be exported — the core "unextractable device key" property. |
| **FidoWallet** | Rivet key wrapped by a WebAuthn PRF secret (Secure Enclave); blob optionally backed up server-side via `/fido/blob` (survives iOS ITP eviction). | Key release gated by platform authenticator. |
| **Web3Wallet** | External plugin (e.g. MetaMask) holds the key.                                              | Custody is the plugin's. |
| **BrowserWallet** | **Legacy.** Private key stored directly.                                                 | **Plaintext — not secure. See divergences.** |

Server/domain wallets live in `~/.epistery/<domain>/config.ini` (0600).

> The unextractable-key guarantee holds **only** on the RivetWallet (and FIDO)
> path with WebCrypto available. The fallback and legacy paths persist plaintext —
> see [Known divergences](#known-divergences-audit).

### The `/connect` handshake & contract binding

1. The client `Witness` signs a challenge with its rivet and POSTs to `/connect`
   with `clientAddress` (rivet), optional `identityAddress`/`contractAddress`.
2. The server verifies the signature. If a contract is claimed, it calls
   `IdentityContract.isAuthorized(rivet)` **on-chain** — the chain is truth.
3. On success it issues the signed `_epistery` cookie, recording the rivet and (if
   verified) the contract. The auth middleware then surfaces the contract as
   `req.episteryClient.address`.

A rivet is bound to a contract client-side via `wallet.upgradeToContract(contract)`
(the wallet then presents the contract as its `address`, keeping the rivet as
`rivetAddress`), followed by a fresh key exchange.

---

## Authorization: on-chain lists & roles

Authorization is a **single number** per address, read from the active contract's
on-chain lists. The system convention:

| Level | Role  |
|-------|-------|
| 0     | none  |
| 1     | read  |
| 2     | edit  |
| 3     | admin |

Server API: `getList`, `getLists`, `isListed`, `getListsForMember(address)`,
`addToList(listName, address, name, role, meta)`, `removeFromList`, `updateEntry`.
HTTP: `/lists`, `/list`, `/list/check/:address`, and the managed `/whitelist/*`
surface (with an embeddable widget + admin UI). Consumers resolve a level and gate
on it; they do not store their own membership.

---

## HTTP interface

Mounted under `rootPath` (default `/.well-known/epistery`, RFC 8615):

| Path | Methods | Purpose |
|------|---------|---------|
| `/`, `/status` | GET | Server wallet status (JSON / HTML) |
| `/lib/:module` | GET | Client libraries (`witness.js`, `client.js`, …) |
| `/artifacts/:file` | GET | Contract ABIs/artifacts |
| `/connect` | GET / POST | Session check / key-exchange handshake (sets `_epistery`) |
| `/create` | GET | Wallet creation helper |
| `/auth/account/claim`, `/auth/dns/claim`, `/auth/account/check-admin` | GET/POST | Domain claiming & admin checks |
| `/data/write`, `/read`, `/ownership`, `/message`, `/conversation(s)`, `/conversation-id`, `/post(s)`, `/public-keys/:address`, `/prepare-write`, `/prepare-transfer-ownership`, `/submit-signed` | GET/POST/PUT | Data-wallet ops (client signs → server submits) |
| `/approval/create`, `/get`, `/get-all`, `/get-all-requestor`, `/handle`, `/prepare-create`, `/prepare-handle` | POST | Approval workflow |
| `/identity/prepare-deploy`, `/prepare-add-rivet` | POST | Deploy an IdentityContract / authorize a rivet |
| `/domain/initialize` | POST | Initialize a domain wallet |
| `/notabot/commit`, `/score/:rivetAddress` | GET/POST | Notabot human-likelihood scoring |
| `/lists`, `/list`, `/list/check/:address` | GET | On-chain list/role reads |
| `/contract/version` | GET | IdentityContract version info |
| `/whitelist/*` | GET/POST | List/ACL management UI, check/add/remove/setName/resolveName, request-access + handling |
| `/fido/blob`, `/blob/:credentialId` | POST/GET | PRF-wrapped rivet key backup |

---

## Server API

```javascript
import { Epistery, Config } from 'epistery';

const epistery = await Epistery.connect({
  authentication:  async (clientInfo) => { /* return profile or null */ },
  onAuthenticated: async (clientInfo, req, res) => { /* post-auth hook */ },
});
await epistery.setDomain('mydomain.com');
await epistery.attach(app);              // mounts middleware + routes under rootPath
```

`Epistery` (exported as `EpisteryAttach`): `connect`, `setDomain`, `attach`,
`resolveClient(req)` (auth resolution for non-middleware contexts, e.g. WebSocket
upgrades), the list methods above, `resolveName`/`setAddressName`, `getSponsor`,
`checkContractVersion`, `buildStatus`, `routes`.

Also exported: `Config`, `chainFor`, `registerChain`, `configuredChains`,
`defaultChainId`, `Chain`.

### Config

Path-based ini config under `~/.epistery` (`src/utils/Config.ts`):

```javascript
import { Config } from 'epistery';
const config = new Config();
config.setPath('/');            // ~/.epistery/config.ini  (root)
config.load();
config.data.profile.email = 'user@example.com';
config.save();
config.setPath('/mydomain.com'); // ~/.epistery/mydomain.com/config.ini
```

Methods: `setPath`, `getPath`, `load`, `save` (+ `data`).

---

## Client API (`Witness`)

Served at `/.well-known/epistery/lib/witness.js`:

```javascript
import Witness from '/.well-known/epistery/lib/witness.js';
const witness = await Witness.connect({ rootPath: '/' }); // creates/loads wallet, runs key exchange
```

Public surface: `connect`, `performKeyExchange`, `getWallets`, `getStatus`,
`addBrowserWallet` / `addFidoWallet` / `addWeb3Wallet`, `setDefaultWallet`,
`removeWallet`, `updateWalletLabel`, `bindToEpisteryIdentity` (cross-host identity
ferry), and data-wallet/approval event methods (`readEvent`, `writeEvent`,
`transferOwnershipEvent`, approval events). Wallet classes: `RivetWallet`,
`FidoWallet`, `Web3Wallet`, `BrowserWallet`; binding via `wallet.upgradeToContract`.

---

## CLI

Stateless bot authentication (each request independently signed):

```bash
epistery initialize localhost
epistery set-default localhost
epistery curl https://api.example.com/data
epistery curl -X PUT -d '{"title":"Test"}' https://api.example.com/wiki/Test
epistery curl -b -w production.example.com https://api.example.com/data   # -b bot, -w wallet, -v verbose
```

Commands: `initialize`, `set-default`, `info`, `curl`, `mcp`, `lists`, `list`,
`requests`, `approve`, `deny`, `help`. See [CLI.md](CLI.md).

---

## Chains

Each EVM chain is a `Chain` object owning its RPC, fee policy, and gas strategy.
Only `chainId` is required; everything else comes from the class. Use
`chainFor({ chainId })`; add a chain by extending `Chain` + `registerChain()`.
See [src/chains/README.md](src/chains/README.md).

---

## Versioning & local development

- Consumers depend on the **published** package: `npm install epistery@latest`.
- Local cross-package work installs a **temporary relative path**
  (`npm install ../../rootz/epistery`) for testing only.
- Publishing to npm and any deployment is a deliberate, human-performed step. No
  tooling or agent publishes, bumps versions, or deploys on its own.

---

## Known divergences (audit)

Where the code currently fails the contract above. Dated; remove as fixed.

**2026-05-27 — opening audit**

1. **Plaintext private keys (critical).** Two paths persist the secp256k1 private
   key in clear in browser storage, defeating the unextractable-key guarantee:
   - `RivetWallet` WebCrypto **fallback** (`client/wallet.js:369`): stores the raw
     key in the field named `encryptedPrivateKey` ("Not actually encrypted in
     fallback").
   - `BrowserWallet` (`client/wallet.js:241`, comment `:283`): stores `privateKey`
     openly (legacy fallback).
   - **Required:** never persist a plaintext signing key. Hard-fail (or refuse to
     create a persistent wallet) when the secure path is unavailable, rather than
     silently downgrading.

2. **No in-session rivet→contract upgrade.** `Witness.performKeyExchange`
   (`client/witness.js:~477`) short-circuits when the existing cookie address
   equals `signingAddress` (the rivet). The rivet never changes across an upgrade,
   so a device that already has a rivet session can never have its `_epistery`
   cookie re-issued as contract-bound; a reload does not help. **Fix:** compare the
   cookie address to `identityAddress` (the presented identity), not the signer,
   so the exchange re-runs whenever the identity changes.

3. **Downstream identity bypass (consumer: epistery.app).** Recorded here because
   it stems from gaps above: consumers have asserted contract identity via a
   spoofable `x-identity-contract` header + localStorage instead of the verified
   `_epistery` cookie, and rolled their own per-session ACL instead of reading the
   on-chain list role. To be corrected in the consumer once (1) and (2) land.

---

## License

MIT — see [LICENSE](LICENSE).

## Links

- Repository: https://github.com/rootz-global/epistery
- See [CLI.md](CLI.md), [Architecture.md](Architecture.md), [SESSION.md](SESSION.md)