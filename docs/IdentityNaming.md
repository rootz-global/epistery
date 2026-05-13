# Identity Naming: Decoupling Names from Roles and Lists

**Status:** Introduced in `epistery` agent contract v3.2.0 (2026-05-13).

## Principle

The human-readable name of an address is a property of the **address itself**, not of any (address, list) join. Roles ("owner", "admin", "read", ...) belong on whitelist entries; names do not.

### Why this matters

Earlier versions used `WhitelistEntry.name` as the identity-name source. That had two failure modes:

1. The same address on multiple lists could carry different names — the resolver returned whichever it walked first.
2. Privileged addresses (the contract sponsor / domain host) often surface in portal UIs as `(auto) Owner` or `(auto) Host` rows with role-label strings in the name slot, marked uneditable. Those addresses became "stranded" — the system couldn't recognize them under the user's real name.

The fix is to give names their own primitive: a `addressNames[owner][addr] → name` mapping, separate from whitelists.

## Contract surface (agent.sol v3.2.0)

```solidity
// Storage
mapping(address => mapping(address => string)) private addressNames;

// Event
event AddressNameSet(address indexed owner, address indexed addr, string name);

// Writes (caller's scope: msg.sender is the naming owner — typically the domain wallet)
function setAddressName(address addr, string memory name) external;

// Reads (specify the owner-scope explicitly)
function getAddressName(address ownerAddress, address addr) external view returns (string memory);
```

Pass an empty string to `setAddressName` to clear a name. Names are limited only by gas / storage cost; epistery clients clamp to 128 chars at the route layer.

### What did NOT change

`WhitelistEntry { addr, name, role, meta }` keeps all four fields. The `name` field on the join is now reinterpreted as a **per-list handle / role-label slot** — it may evolve into a useful per-list display field, but it is no longer the identity name source. The resolver does not read it.

Existing data in `WhitelistEntry.name` is preserved on chain; the only change is that nothing in the auth path consults it for identity.

### Older contracts

Agent contracts deployed before v3.2.0 do not have `getAddressName`. The TypeScript resolver swallows the resulting RPC error and returns `undefined`. Domains running older contracts continue to function — they just have no addresses with resolved names until the contract is upgraded.

## TypeScript surface

### `Utils` static methods (`src/utils/Utils.ts`)

```ts
// Read — one RPC call, returns undefined if unset or on older contracts
Utils.ResolveAddressName(
  wallet: Wallet,
  ownerAddress: string,        // typically domain wallet address
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

`resolveName` reads the on-chain mapping under the current domain's scope.

## Auth middleware

The per-request enrichment middleware in `index.mjs` calls `epistery.resolveName(req.episteryClient.address)` and attaches the result as `req.episteryClient.name`. Failure is silent (most domains will have many addresses with no name set; logging on every miss would flood logs).

Downstream consumers can read the resolved name from:

- `req.episteryClient.name` (server-side, any route)
- `GET /epistery/connect` response: `{ address, name }` when a name is set
- `POST /epistery/connect` (key exchange) response: `clientInfo.name` if set
- `req.whitelistAuth.name` inside the whitelist router

The client-side `ClientWalletInfo` interface (`src/utils/types.ts`) has `name?: string` for type completeness.

## Migration

For a domain running an existing agent contract:

1. **Recompile + redeploy** the v3.2.0 agent contract for that domain (`npx hardhat compile`, then `npm run deploy:agent` against your target network). Existing `WhitelistEntry` rows are not in the new contract — redeployment is a fresh state unless you carry data over manually.

2. **Bootstrap names** after redeploy. For each address that should have a name (you, your collaborators, named services), call:

   ```bash
   curl -X POST https://<your-domain>/.well-known/epistery/whitelist/setName \
     -H "Cookie: _epistery=<your admin session>" \
     -H "Content-Type: application/json" \
     -d '{"address":"0xe75Fc5...", "name":"michael"}'
   ```

   Or programmatically:

   ```js
   await epistery.setAddressName("0xe75Fc5...", "michael");
   ```

3. **No client changes required** for existing flows — the resolver runs in middleware and surfaces the name wherever `req.episteryClient` is consumed.

If you want to avoid a redeploy, you can defer: the system continues to function as it did, `req.episteryClient.name` just stays undefined for everyone. The new methods become available the moment the contract is upgraded.

## Related changes in the same release

- The connect routes (`routes/connect.mjs`) include `name` in the GET response and the POST key-exchange response when available.
- The `request-access` / `handle-request` flow still accepts an optional `name` on the request body, which is written into the legacy `WhitelistEntry.name` slot (per-list handle) — not into the new identity-name mapping. Admins who want to set the identity name should call `/whitelist/setName` explicitly.

## Reasoning summary (for cross-session context)

The motivating bug: a user whose desktop is the contract sponsor was being rendered by portal UIs as `(auto) Owner` (uneditable), while the same user on other devices was correctly named `"michael"`. The resolver, walking whitelist entries, would either find "Owner" (a role label leaked into the name field) or nothing — so the user's most privileged device was the one the system could not recognize as them.

The structural cause: `WhitelistEntry.name` was overloading two distinct concepts — a per-list role/handle label, and the user's identity name. The same address on different lists could legitimately have different per-list handles, but the user has *one* name. Putting that name on the join was wrong.

The fix is the minimum architectural correction: pull the name off the join, put it on the address, scoped by the domain that's doing the naming. Roles stay where they are. Old data stays where it is. The resolver gets simpler (one RPC call), and privileged-address rendering becomes the portal UI's concern, not the data model's.