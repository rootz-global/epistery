# Identity Naming: Decoupling Names from Roles and Lists

**Status:** Introduced 2026-05-13 as the first interface in the cross-system epistery contract spec — `IAddressNaming` (`contracts/IAddressNaming.sol`). The epistery package exports the interface; the deployed contracts in each repo (`epistery-host/contracts/DomainAgent.sol`, `rootz-v6/contracts/UniversalTeamRegistryV4.sol`, …) opt in by declaring `is IAddressNaming` and bumping their own VERSION.

## Principle

The human-readable name of an address is a property of the **address itself**, not of any (address, list) join. Roles ("owner", "admin", "read", …) belong on whitelist entries; names do not.

### Why this matters

Earlier versions used `WhitelistEntry.name` as the identity-name source. Two failure modes:

1. The same address on multiple lists could carry different names — the resolver returned whichever it walked first.
2. Privileged addresses (the contract sponsor / domain host) often surface in portal UIs as `(auto) Owner` or `(auto) Host` rows with role-label strings in the name slot, marked uneditable. Those addresses became "stranded" — the system couldn't recognize them under the user's real name.

The fix: give names their own primitive, separate from whitelists, exposed through a shared interface so every contract that needs identity naming implements it the same way.

## The interface (`contracts/IAddressNaming.sol`)

```solidity
interface IAddressNaming {
    function setAddressName(address addr, string memory name) external;
    function getAddressName(address ownerAddress, address addr) external view returns (string memory);
}
```

Pass an empty string to `setAddressName` to clear a name. Names are limited only by gas / storage cost; epistery clients clamp to 128 chars at the route layer.

### How implementations differ

The interface accommodates two tenancy models:

| Implementation | Tenancy | Storage | `ownerAddress` arg on read |
|---|---|---|---|
| `epistery/contracts/agent.sol` (archetype) | Multi-tenant | `addressNames[msg.sender][addr] → name` | Used to select the naming scope |
| `epistery-host/contracts/DomainAgent.sol` | Single-tenant (per domain) | `addressNames[addr] → name` | Accepted on the signature for ABI parity; ignored |
| `rootz-v6/.../UniversalTeamRegistryV4.sol` | (when adopted) | per Steven's design | per Steven's design |

`epistery/contracts/agent.sol` is the **archetype** — a reference implementation, not a deployed contract. The actually-deployed contracts are forks (`DomainAgent.sol`, `UniversalTeamRegistryV4.sol`) that adopt the interface independently.

### What did NOT change

`WhitelistEntry { addr, name, role, meta }` (and the `ACLEntry` equivalent in `DomainAgent.sol`) keeps all four fields. The per-entry `name` slot is now reinterpreted as a **per-list handle / role-label slot** — it may evolve into a useful per-list display field, but it is no longer the identity name source. The resolver does not read it.

Existing data in those `name` fields is preserved on chain; the only change is that nothing in the auth path consults it for identity.

### Contracts that haven't adopted yet

For contracts deployed before `is IAddressNaming` was declared on them, the `getAddressName` call reverts. The TypeScript resolver swallows the resulting RPC error and returns `undefined` — the request still goes through, just without a resolved name. Domains running pre-adoption contracts continue to function; they just have no addresses with names until the contract is upgraded.

## TypeScript surface

### `Utils` static methods (`src/utils/Utils.ts`)

```ts
// Read — one RPC call, returns undefined if unset or on pre-adoption contracts
Utils.ResolveAddressName(
  wallet: Wallet,
  ownerAddress: string,        // the naming-scope owner (typically the domain wallet)
  addressToCheck: string,
  contractAddress?: string,
): Promise<string | undefined>;

// Write — gas-priced, returns the receipt
Utils.SetAddressName(
  wallet: Wallet,
  addr: string,
  name: string,
  contractAddress?: string,
): Promise<any>;
```

Both work uniformly against any contract that declares `is IAddressNaming`. The off-chain code holds against the interface signature, not against any particular contract type.

### `EpisteryAttach` (instance methods on `index.mjs`)

```js
// Read — uses the current domain wallet as the naming scope
await epistery.resolveName(address);
//   → string | undefined

// Write — uses the current domain wallet as the naming scope
await epistery.setAddressName(address, name);
//   → tx receipt
```

## HTTP routes

Mounted under the whitelist router (`routes/whitelist/index.mjs`):

| Method | Path                              | Auth         | Body / Query                    | Response                              |
|--------|-----------------------------------|--------------|---------------------------------|---------------------------------------|
| POST   | `/whitelist/setName`              | admin only   | `{ address, name }` (JSON)      | `{ success: true, address, name }`    |
| GET    | `/whitelist/resolveName?address=` | public read  | `?address=0x…`                  | `{ address, name: string \| null }`   |

`setName` validates `address` (0x-prefixed 40 hex), accepts any string for `name` (empty string clears), and clamps name length to 128 chars.

`resolveName` reads from whichever `IAddressNaming` contract this domain is configured with.

## Auth middleware

The per-request enrichment middleware in `index.mjs` calls `epistery.resolveName(req.episteryClient.address)` and attaches the result as `req.episteryClient.name`. Failure is silent (most domains will have many addresses with no name set; logging on every miss would flood logs).

Downstream consumers can read the resolved name from:

- `req.episteryClient.name` (server-side, any route)
- `GET /epistery/connect` response: `{ address, name }` when a name is set
- `POST /epistery/connect` (key exchange) response: `clientInfo.name` if set
- `req.whitelistAuth.name` inside the whitelist router

The client-side `ClientWalletInfo` interface (`src/utils/types.ts`) has `name?: string` for type completeness.

## Adoption — per fork

The interface ships in the epistery npm package. Each deployed-contract fork adopts on its own cadence:

### For `epistery-host/contracts/DomainAgent.sol`

1. `import "epistery/contracts/IAddressNaming.sol";` and declare `is IAddressNaming` on the contract (already done as of v1.4.1).
2. Add `mapping(address => string) private addressNames;` and implement `setAddressName` / `getAddressName` (already done).
3. Recompile, redeploy, update `~/.epistery/{domain}/config.ini` to point at the new contract address (the deploy flow in `index.mjs` writes this; the migration helper in `utils/DomainChain.mjs` lifts old `WhitelistEntry.name` values into the new mapping).
4. Bootstrap names admin-side:
   ```js
   await epistery.setAddressName("0xe75Fc5...", "michael");
   ```

### For `rootz-v6/.../UniversalTeamRegistryV4.sol`

Steven's call when he wants to. Adoption is:
1. `import "epistery/contracts/IAddressNaming.sol";` and declare `is IAddressNaming`.
2. Add the `addressNames` mapping + the two methods. Choose the tenancy model that matches his contract's existing scope (single- or multi-tenant on `msg.sender`).
3. Redeploy (or use his existing upgrade path).

Off-chain consumers (epistery's `Utils.ResolveAddressName`, anyone using the resolver via the npm package) keep working against either side without code changes.

## Related changes in the same release

- The connect routes (`routes/connect.mjs`) include `name` in the GET response and the POST key-exchange response when available.
- The `request-access` / `handle-request` flow still accepts an optional `name` on the request body, which is written into the legacy `WhitelistEntry.name` slot (per-list handle) — not into the new identity-name mapping. Admins who want to set the identity name should call `/whitelist/setName` explicitly.

## Reasoning summary (for cross-session context)

The motivating bug: a user whose desktop is the contract sponsor was being rendered by portal UIs as `(auto) Owner` (uneditable), while the same user on other devices was correctly named `"michael"`. The resolver, walking whitelist entries, would either find "Owner" (a role label leaked into the name field) or nothing — so the user's most privileged device was the one the system could not recognize as them.

The structural cause: `WhitelistEntry.name` was overloading two distinct concepts — a per-list role/handle label, and the user's identity name. The same address on different lists could legitimately have different per-list handles, but the user has *one* name. Putting that name on the join was wrong.

The fix is the minimum architectural correction: pull the name off the join, put it on the address, scoped by the domain that's doing the naming. Roles stay where they are. Old data stays where it is. The resolver gets simpler (one RPC call), and privileged-address rendering becomes the portal UI's concern, not the data model's.

The cross-system mechanism is the interface (`IAddressNaming`) — every contract that wants to be a naming source declares conformance. The interface lives in epistery; the implementations live in the forks. No code is shared, no contract inherits from another; alignment is by signature, not by source.
