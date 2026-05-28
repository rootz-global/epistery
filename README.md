# Epistery

_Epistemology is the study of knowledge. An Epistery, it follows, is a place to share the knowledge of knowledge._

**Epistery is the identity foundation for web applications.** It gives a host one
thing it can trust on every request — a cryptographically proven address — and
binds that address to an on-chain IdentityContract when the user wants a durable
multi-device identity. Everything else (data, ACLs, naming, content) is the host
application's concern, not epistery's.

> **Status — sealed contract, v1.2 (2026-05-27).** This README defines what
> epistery is responsible for, what it is not, and its interface. Code is held to
> this document. The `agent.sol` surface (data wallets, approvals, whitelist /
> lists / roles, name registry, notabot) was **removed in v1.2**; see the wiki
> archives ([[NotABot]], [[Whitelist]], [[DataWallets]], [[Approvals]],
> [[ContractStandards]]) and git tag `epistery-pre-identity-refactor` for the
> retired implementations. The dated **[Known divergences](#known-divergences-audit)**
> section at the end lists where the current code still fails this contract.
> If behavior and this document disagree, that is a bug in the code, not the doc.

---

## Responsibility (what epistery OWNS)

Epistery is the **single owner** of:

1. **Identity** — proving *who* a request is from. The proof is a wallet
   signature, carried either by a short-lived signed session cookie (`_epistery`,
   established via the `/connect` handshake) or a per-request `Bot` signature.
   The result is a trusted **address** on `req.episteryClient`.
2. **Identity binding** — relating a device key (rivet) to an **IdentityContract**,
   verified on-chain (`isAuthorized`). When bound, epistery presents the *contract*
   as the identity.
3. **Key custody (client)** — generating and protecting the user's signing key in
   the browser (non-extractable; see [Key custody](#identity--key-custody)).
4. **Domain/server wallet & config** — the host's own wallet and the path-based
   `~/.epistery` configuration.
5. **FIDO blob storage** — server-side backup of WebAuthn-PRF-wrapped rivet keys
   so they survive iOS ITP IndexedDB eviction.

No consumer may bypass, re-derive, or duplicate any of these. In particular: a
downstream service **never** trusts a client-supplied identity header and
**never** re-implements identity resolution.

---

## What Epistery DOES

- **Authenticates every request** to a trusted address (`req.episteryClient`),
  via signed `_epistery` session cookie or `Bot` signature.
- **Mints/loads wallets** for the browser (rivet / FIDO / web3) and server
  (per-domain).
- **Binds a device to an IdentityContract** and verifies that binding on-chain.
- **Serves client libraries** at `/lib/*` (`witness.js`, `wallet.js`, `ethers.js`,
  …) and contract artifacts at `/artifacts/*` for consumers.
- **Persists FIDO blobs** (`/fido/blob`) — encrypted, PRF-wrapped rivet keys for
  WebAuthn-backed identities.
- **Exposes a CLI** for stateless bot-authenticated requests (`curl`), the
  Streamable-HTTP MCP bridge (`mcp`), domain initialization, and basic info.

## What Epistery does NOT do

- **Does not store application data.** Apps own their storage; epistery records
  identity, not your documents.
- **Does not manage contracts.** It *binds keys to existing contracts* and
  *verifies* the binding on-chain — it does not deploy, write to, or own
  application contracts. Contract creation and on-chain ACL/state live in host
  contracts (e.g. `IdentityContractV3.sol`, `DomainContract.sol`).
- **Does not define application- or session-level ACLs.** Authorization is the
  host's job, evaluated against the trusted address epistery provides.
- **Does not run a name registry.** Per-domain naming is a relay service; epistery
  carries no name → address mapping.
- **Does not accept a client's claim of identity.** The only identity is the one
  epistery itself proved (`req.episteryClient`). There is no "I am contract X"
  header. Contract identity claims are verified on-chain at `/connect` and sealed
  into the signed cookie.
- **Does not let downstream code adjudicate auth.** Re-deriving identity or
  re-checking signatures outside epistery is a contract violation.

---

## The trust contract: `req.episteryClient`

The attach middleware sets exactly this on each request (or leaves it `undefined`):

| Field             | Meaning |
|-------------------|---------|
| `address`         | **The identity.** The IdentityContract address when the wallet is bound; otherwise the rivet (device) address. This is what downstream uses. |
| `signerAddress`   | The rivet that actually signed (the device key). Present when bound. |
| `contractAddress` | The bound IdentityContract, or `null`. |
| `publicKey`       | The signer's public key. |
| `authenticated`   | Whether the session/handshake completed. |
| `authType`        | `"bot"` for `Bot`-signed requests; cookie-based otherwise. |

**Rule for consumers:** treat `address` as the principal. The *type* (rivet vs.
contract vs. bot) is available but is rarely your concern. Authorization is yours
to evaluate against that address, using your host's own contracts/policy.

```javascript
app.get('/thing', (req, res) => {
  const me = req.episteryClient;            // the ONLY source of identity
  if (!me?.authenticated) return res.status(401).end();
  // authorize against your host's contracts / policy
});
```

---

## Identity & key custody

The browser signing key is created and protected by epistery. Custody depends on
wallet type:

| Wallet         | Key custody | Security property |
|----------------|-------------|-------------------|
| **RivetWallet** (default) | secp256k1 private key **encrypted at rest** by a **non-extractable** AES-GCM `CryptoKey` held in IndexedDB (WebCrypto). Only ciphertext + a key id are persisted. **Refuses to create the wallet if WebCrypto is unavailable** — no plaintext fallback. | The signing key cannot be exported — the core "unextractable device key" property. |
| **FidoWallet** | Rivet key wrapped by a WebAuthn PRF secret (Secure Enclave); blob optionally backed up server-side via `/fido/blob` (survives iOS ITP eviction). | Key release gated by platform authenticator. |
| **Web3Wallet** | External plugin (e.g. MetaMask) holds the key. | Custody is the plugin's. |

A device can hold **multiple independent rivets** (Browser/FIDO/Web3 are all
rivets — different ways of presenting a device-locked signing key). This is how
the system enforces one-key-one-identity without a hard cross-context check: the
user mints another isolated rivet rather than pointing one key at two contracts.

Server/domain wallets live in `~/.epistery/<domain>/config.ini` (0600).

### The `/connect` handshake & contract binding

1. The client `Witness` signs a challenge with its rivet and POSTs to `/connect`
   with `clientAddress` (rivet), optional `identityAddress`/`contractAddress`.
2. The server verifies the signature. If a contract is claimed, it calls
   `IdentityContract.isAuthorized(rivet)` **on-chain** — the chain is truth.
3. On success it issues the signed `_epistery` cookie, recording the rivet and
   (if verified) the contract. The auth middleware then surfaces the contract as
   `req.episteryClient.address`.

A rivet is bound to a contract client-side via `wallet.upgradeToContract(contract)`
(the wallet then presents the contract as its `address`, keeping the rivet as
`rivetAddress`), followed by a fresh key exchange. The rivet→contract relation
in localStorage is not cryptographically sealed in the browser — but spoofing it
is useless: the contract knows its authorized signers and can't be spoofed; the
on-chain verification at `/connect` is the gate.

---

## HTTP interface

Mounted under `rootPath` (default `/.well-known/epistery`, RFC 8615):

| Path | Methods | Purpose |
|------|---------|---------|
| `/` | GET | Server status JSON (`Witness.connect` probes this for chain/provider info). No HTML UI. |
| `/lib/:module` | GET | Client libraries (`witness.js`, `wallet.js`, `client.js`, `ethers.js`, …) |
| `/artifacts/:file` | GET | Contract ABIs/artifacts |
| `/connect` | GET / POST | Session check / key-exchange handshake (sets `_epistery`; on-chain `isAuthorized` verify for contract claims) |
| `/create` | GET | Wallet creation helper |
| `/auth/account/claim`, `/auth/dns/claim`, `/auth/account/check-admin` | GET/POST | Domain claiming & admin checks |
| `/identity/prepare-add-rivet` | POST | Unsigned tx for adding a rivet to an existing IdentityContract (client signs, then `/data/submit-signed`-style broadcast) |
| `/domain/initialize` | POST | Initialize a domain wallet |
| `/fido/blob`, `/fido/blob/:credentialId` | POST/GET | PRF-wrapped rivet key blob storage |

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
upgrades), `buildStatus`, `routes`.

Also exported: `Config`, `chainFor`, `registerChain`, `configuredChains`,
`defaultChainId`, `Chain`.

The core `Epistery` static API (`src/epistery.ts`): `initialize`, `createWallet`,
`getStatus`, `handleKeyExchange` (consumed by `/connect`),
`prepareAddRivetToContract` (unsigned tx builder), `submitSignedTransaction`
(generic broadcaster for client-signed transactions — this is the
"server-requests-signature, interactive wallet (FIDO/MetaMask) signs, then submit"
path).

### Config

Path-based ini config under `~/.epistery` (`src/utils/Config.ts`):

```javascript
import { Config } from 'epistery';
const config = new Config();
config.setPath('/');             // ~/.epistery/config.ini  (root)
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
ferry). Wallet classes: `RivetWallet`, `FidoWallet`, `Web3Wallet`; binding via
`wallet.upgradeToContract`.

---

## CLI

Stateless bot authentication (each request independently signed):

```bash
epistery initialize localhost
epistery set-default localhost
epistery info localhost
epistery curl https://api.example.com/data
epistery curl -X PUT -d '{"title":"Test"}' https://api.example.com/wiki/Test
epistery curl -b -w production.example.com https://api.example.com/data   # -b bot, -w wallet, -v verbose
epistery mcp https://api.example.com    # stdio MCP bridge with bot-auth
```

Commands: `initialize`, `set-default`, `info`, `curl`, `mcp`, `help`. See
[CLI.md](CLI.md).

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

**Resolved in v1.2 (2026-05-27 identity-only refactor)**

- **Plaintext private keys.** `BrowserWallet` (extractable-key legacy wallet) is
  removed; `RivetWallet` WebCrypto fallback now **throws** rather than silently
  storing a plaintext key. No code path persists a cleartext signing key.
- **`agent.sol` surface.** Data wallets (`/data/*`), approvals (`/approval/*`),
  whitelist (`/whitelist/*`), on-chain lists/roles (`/lists`, `/list`), name
  registry (`resolveName`/`setAddressName`), `notabot`, contract creation
  (`/identity/prepare-deploy`), `contracts/` directory — all removed. epistery
  is now identity + storage/config + FIDO blob only.
- **Client header trust path.** Removed at the server boundary in v1.2: the
  middleware no longer reads `x-identity-contract`; identity is the
  `req.episteryClient.address` epistery itself proved.

**Outstanding**

1. **No in-session rivet→contract upgrade.** `Witness.performKeyExchange`
   (`client/witness.js`) short-circuits when the existing cookie address equals
   `signingAddress` (the rivet). The rivet never changes across an upgrade, so a
   device that already has a rivet session can never have its `_epistery` cookie
   re-issued as contract-bound; a reload does not help. **Fix:** compare the
   cookie address to `identityAddress` (the presented identity), not the signer,
   so the exchange re-runs whenever the identity changes.

2. **Downstream identity bypass (consumer: `epistery.app`).** Consumers have
   asserted contract identity via a spoofable `x-identity-contract` header +
   localStorage instead of the verified `_epistery` cookie, and rolled their own
   per-session ACL. To be corrected in the consumer once (1) lands (so an
   existing rivet session can be upgraded into a contract-bound cookie).

---

## License

MIT — see [LICENSE](LICENSE).

## Links

- Repository: https://github.com/rootz-global/epistery
- See [CLI.md](CLI.md), [Architecture.md](Architecture.md), [SESSION.md](SESSION.md)