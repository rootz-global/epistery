<!-- COPY — DO NOT EDIT HERE.
     canonical: rootz-global/corpid → docs/AUTHORITY-INTERFACE.md
     version:   authority-interface/1
     sha256:    35dc7a0a80031069e2275f2ae494ad7e613bfe275d9189a75ae23061d2148bf5
     copied:    2026-09-12
     If the canonical file's digest differs from the value above, this copy is stale.
     Re-copy it. Never edit a copy — see §7. -->

# Authority Interface — `authority-interface/1`

> **Cross-repo contract between CorpID, Rootz V6 and Epistery.**
> Canonical source: `rootz-global/corpid` → `docs/AUTHORITY-INTERFACE.md`.
> Copies in `rootz-v6` and `epistery` carry a provenance header; if the digest there does not match this
> file, the copy is stale — re-copy, never edit a copy.
>
> **Version:** `authority-interface/1` · **Adopted:** 2026-09-12
> **Pattern:** the same one Epistery established with `IAddressNaming` (`docs/IdentityNaming.md`) — one
> interface defined once, each repo opts in explicitly and states the version it builds against.

---

## 0. Why this document exists

Three repos are building one thing. Today they use **the same words for different objects** and **different
words for the same object**, and the authority model has already drifted once inside a single day.

This is not documentation hygiene. Each item below has already produced, or was about to produce, a concrete
defect:

| Drift | What it produced |
|---|---|
| "CorpID authorizes; V6 executes" | An architecture where a Rootz application is the validator — the chain says *"ask Rootz"*, which inverts corporate sovereignty |
| `depth` vs `origin_method` vs a second grade ladder | Two evidence vocabularies inside one repo, in one day |
| `biometric` as a rung on a strength ladder | Ranked a photocopied passport above a DKIM signature |
| **"delegation"** in CorpID vs Epistery | Two genuinely different objects sharing one word — see §1.1 |
| **"rivet"** as identity vs as device | Ambiguity about what `subject_id` even points at — see §1.2 |

**Read §1–§3 before writing code or prose in any of the three repos.** §4–§6 are the consumption contract:
what each project must offer, and what it must not decide alone.

---

## 1. Name collisions, resolved

### 1.1 ⚠️ "Delegation" means two different things. Stop using it unqualified.

| | **Authorization** (CorpID) | **Delegation Token** (Epistery) |
|---|---|---|
| What it is | A corporation's durable grant of a **title and scope** to a subject identity, for a period | A short-lived **bearer credential** proving a rivet authorized an action on a domain |
| Shape | subject · title · scope · grade · starts_at · ends_at · revocation | issuer · subject · audience · scope · expires · nonce, in a cookie |
| Lifetime | Years. Survives the person leaving | Minutes to hours |
| Answers | *Was this person the Treasurer on 3 March 2025?* | *May this browser call this endpoint right now?* |
| Where it belongs | On chain, against the corporation's root | In a session |
| Revocation | Forward-only, permanently recorded | Expiry |

**Rule:** CorpID's object is an **Authorization**. Epistery's is a **Delegation Token**. A Delegation Token
MAY reference an Authorization; it MUST NOT substitute for one.

**Why this matters beyond tidiness:** a Delegation Token is session-shaped — audience-scoped, expiring,
bearer. The house position is *message signing, not auth/login*: the signature IS the authority, and a
bearer token that grants access is a different security model with different failure modes. Conflating them
would let "the user was logged in" masquerade as "the corporation authorized this act," which is exactly the
claim we sell against.

*(CorpID's schema field is still literally `delegation` for compatibility. Prose, new APIs and all
cross-repo discussion say **Authorization**. The field is scheduled for rename at the next schema version.)*

### 1.2 "Rivet" — reconciled, not in conflict

Two definitions exist and they are compatible; state it once so nobody re-litigates it:

- Epistery (`docs/RivetSignerConfigAuthority.md`, 2026-06-23): *"a rivet is an unextractable-but-usable
  signing identity. The private key lives with a custodian that never hands it out; callers get signatures,
  not keys."*
- V6 (`packages/identity-provider`): *"an IdentityContract can have multiple authorized devices (rivets)."*

**Reconciled:** a **rivet** is an unextractable signing key held by a custodian (Secure Enclave, TPM, TEE,
WebAuthn-PRF, a signing RPC). An **Identity** is the durable on-chain contract that authorizes one or more
rivets. A rivet signs; an Identity persists.

**Rule:** **the subject of an Authorization is an Identity, never a rivet.** Epistery's older
`docs/DELEGATION.md` leads with the Rivet as the identity; that framing must not be carried into authority
records.

**Why:** rivets are per-device and mortal. People replace laptops. If authority binds to a rivet, the record
fragments on every hardware change and dies with a lost device — and the accrued history, which is the whole
product, dies with it.

---

## 2. Shared vocabulary

Use these words with these meanings in all three repos.

| Term | Means | Does **not** mean |
|---|---|---|
| **Root** | The corporation's own on-chain authority anchor | Anything Rootz owns or hosts |
| **Corporate Digital Name** | The corporation's durable public identifier | A domain, a brand, or a slug |
| **Identity** | A durable contract (EIP-1271) authorizing one or more rivets | A device, a key, or a login |
| **Rivet** | An unextractable signing key held by a custodian | The identity itself (§1.2) |
| **Authorization** | A corporation's grant of title + scope to a subject Identity, for a period | A session, a token, or a permission flag |
| **Delegation Token** | A short-lived bearer credential for domain access | Corporate authority (§1.1) |
| **Subject** | Who or what is authorized — an Identity address | A device key, an email, or a username |
| **Title** | The corporate role (Treasurer, VP Engineering) | A scope |
| **Scope** | The acts permitted (`sign:contracts`) | A title |
| **Grade** | The evidence vocabulary: `acquisition` · `strength` · `factors` · `method` (§3.8) | A score, a badge, or a rating of a person |
| **As-of** | The instant an authority question is asked about | "Now" |
| **Revocation** | Ending authority from a point forward | Deletion, or erasing history |

### Phrases that are banned, and why

| Never write | Write instead | Why |
|---|---|---|
| "CorpID authorizes…" / "Rootz validates…" | "The corporation authorizes; the chain carries it; applications read" | If an application is the validator, the company does not own its identity (§3.1) |
| "we issue an identity" | "the owner creates an identity; the corporation authorizes it" | Identity is created, not issued. An issued identity is one the issuer can withhold |
| "trusted", "verified" as a boolean | the explicit depth/strength | There is no global `trusted=true`; a boolean hides which evidence is missing |
| "provenance" as a catch-all | origin · custody · ownership, named separately | They are different jobs with different evidence; collapsing them is how a weak claim passes as a strong one |
| "multifactor" as a grade value | `factors` with two or more entries | It is derived, never asserted (§3.8) |
| "delegation" unqualified, cross-repo | Authorization, or Delegation Token | §1.1 |

---

## 3. Invariants

These bind all three repos. Each states the rule, **why**, and **how it fails** if ignored.

### 3.1 The corporation authorizes; the chain carries it; applications read

**Why:** sovereignty comes from the **authorizations** — not from a key, an app, a wallet or a database.
Each AUTHORIZE/REVOKE transaction extends the quality of the root and what it can claim
(`corpid/docs/NAME-QUALITY.md`: *"a name has no value on its own; its quality is built from the
authorizations bound to it"*). Authorizations held in a vendor's database are that vendor's asset, not the
company's.

**Fails as:** the chain says *"ask Rootz."* The company cannot leave, the person cannot prove their own
history, and the product contradicts its own published principle that *a completed CorpID should remain
usable if Rootz disappears.*

### 3.2 Validation must be possible without Rootz

**Why:** the evidence is public on chain to the root, so **many technologies can validate** — any RPC
client, any block explorer, a third party's or a competitor's verifier. Rootz software is one replaceable
reader.

**Test it:** *can a stranger holding only a public RPC endpoint answer "was this subject authorized, with
this title, at this instant?"* If the answer requires a Rootz service, the design has failed — no matter how
good the API is.

### 3.3 The subject is an Identity, never a rivet or device key

**Why / fails as:** §1.2. Recovery is **a second rivet** — not a seed phrase, not an escrow, not a
custodian. `identity-provider` already refuses to remove the last rivet.

**Build consequence:** a single-rivet Identity is one lost laptop away from a lost record. **A second rivet
belongs in enrolment, not in an advanced setting.**

### 3.4 Paying is not controlling

A corporation may pay the gas to deploy an employee's Identity. **It is never a rivet on that Identity**, and
the employee's own key is the first rivet.

**Why:** the employee must be able to walk away with the identity intact — that is what makes the record
theirs and makes the accrued history worth anything. If the employer holds a rivet, it can sign as the
person after they leave.

**Ordering, and it is load-bearing:** the employee creates the key and deploys the Identity **before** the
corporation authorizes it. This is the step most likely to be "simplified" into the company generating the
key on the employee's behalf. It must not be.

### 3.5 Every authority question is asked as-of an instant

**Why:** the product question is *"was this subject authorized when they signed?"*, not *"are they authorized
now?"* Current-state-only reads cannot answer it.

**Fails as:** the most likely integration failure in this entire contract. Current-state reads are the
obvious thing to build and they are silently insufficient — nobody discovers it until a relying party asks
about a two-year-old contract. **Any authority read MUST accept an instant.**

### 3.6 Revocation is forward-only

Revoking ends authority from that point. It never rewrites the past: a message signed while authorized still
verifies **as of its own date**.

**Why:** otherwise every past act by a departed employee becomes retroactively void, which is legally wrong
and would make the record useless for exactly the dispute it exists to settle.

### 3.7 Derived fields never enter signed bytes

**Why:** a value computed by the reader, sitting inside signed bytes, lets two parties disagree about the
same signature. Compute derived values on read.

### 3.8 One evidence vocabulary

`acquisition` (ordinal — how we came to hold it) · `strength` (ordinal — **can a third party re-verify it?**:
`self-asserted` → `examined` → `issuer-attested` → `issuer-signed`) · `factors` (**a set, never a rung**:
`document`, `biometric`, `device-bound`, `activation-factor`) · `method` (**never ordinal** — `dkim`,
`signed-pdf`, `mdl-iso18013-5`, `x509-eca`, …).

**Why factors is a set:** a biometric describes what happened at **issuance**, not whether the result is
independently verifiable. A photocopied passport is biometric-backed and proves nothing to a stranger; a
DKIM signature carries no biometric and is re-checkable by anyone. As a rung, biometric ranks the photocopy
above the signature.

**Why method is not ordinal:** the list of mechanisms grows forever. If it were ordinal, **adding a mechanism
would change how two existing grades compare.**

**Alignment worth keeping:** a credential meeting the 2026-09-08 US federal VDC definition is exactly
`issuer-signed` with factors `device-bound` and `activation-factor`.

**Ownership:** this vocabulary is owned by CorpID and consumed by the others (§6). Do not fork it. If a
project needs a value that does not exist, raise it — do not add a local one.

### 3.9 Grade the event, never the person

Grade **the verification event the corporation performed**. Never the person, never their performance, and
**never record which identity document was examined or its contents.**

**Why:** employment references carry defamation and adverse-action exposure, and under US I-9 rules the
employee chooses which document to present — recording which one invites a discrimination claim. Recording
strength and factors gives a relying party everything it needs without any of that.

### 3.10 Depth is explicit; never infer a pass

No global `trusted=true`. Absence stays visible as `gap`.

**Enforceable form:** `acquisition: contract-verified-message` may be claimed **only when the authorizing
transaction can be read back from chain.** An unanchored record is `asserted` and must say so.

---

## 4. What CorpID consumes from Epistery

Capability requirements, not function signatures — Epistery owns the API shape.

| # | Capability | Requirement | Invariant |
|---|---|---|---|
| **E1** | `PUBLISH_AUTHORIZATION` | Publish an AUTHORIZE act against **the corporation's own root**, carrying subject Identity, title, scope, grade and period. Publicly readable without Rootz | 3.1, 3.2 |
| **E2** | `PUBLISH_REVOCATION` | Publish a REVOKE act. Ends authority forward; the prior grant stays readable | 3.6 |
| **E3** | **`READ_AUTHORITY_AS_OF(root, subject, instant)`** | Return authority state **at an arbitrary past instant**, not just current state. **The single most important item in this contract** | 3.5 |
| **E4** | `RESOLVE_ROOT(corporation)` | Given a Corporate Digital Name, return the on-chain root to read from | 3.1 |

**Constraints on all four:** deterministic and reproducible by any reader; no Rootz service in the path; no
private key ever leaves its custodian; CorpID never receives a steward key.

**Out of scope for CorpID to decide:** contract shape, storage layout, chain, gas model, and whether the
record is an event log, a mapping or a profile section. Epistery decides. CorpID states only what it must be
able to read.

---

## 5. What CorpID consumes from Rootz V6

| # | Capability | Requirement | Invariant |
|---|---|---|---|
| **V1** | `SUBJECT_IDENTITY` | The person's Identity contract address — the durable subject id. Never a device key | 3.3 |
| **V2** | `SIGN_LOCAL` | Sign bytes locally with a rivet, verifiable via ERC-1271 against the Identity. Key never leaves the custodian | 3.2 |
| **V3** | `ORIGIN_BUNDLE` | Provenance for signed bytes, carrying the Identity address and a reference to the Authorization (root, authorization id, title, grade, signing instant) | 3.1, 3.5 |
| **V4** | `RIVET_ADD` / `RIVET_REMOVE` | Add and remove device rivets; never remove the last one. This **is** the recovery mechanism | 3.3 |

**Out of scope for CorpID to decide:** custodian choice per platform, installer and notarization, archive
format, agent runtime and policy. V6 decides.

**Note for V6:** an agent acts for a person who is authorized by a corporation. **An agent's scope must never
exceed the scope of the employee who authorized it** — which is why the employee layer has to be right
before the agent layer is built on it.

---

## 6. What CorpID owns, and the others consume

CorpID defines **what an Authorization means**:

- the authority model — subject, title, scope, period, revocation semantics;
- **the evidence vocabulary** (§3.8) — single source of truth, do not fork;
- as-of semantics (§3.5);
- the public verifier, the subject transpose (`GET /api/v1/subject?address=&at=`), and the teaching surfaces
  for humans and AI.

CorpID does **not** own: keys, custodians, signing, the chain record, contract shape, or the agent runtime.

> **CorpID defines what an Authorization means. Epistery carries it. V6 signs with keys.**
> None of the three is the authority. The corporation is.

---

## 7. Conformance

Adoption follows the `IAddressNaming` precedent: each repo opts in explicitly and states the version it
builds against.

1. **Carry the file.** Each repo holds `docs/AUTHORITY-INTERFACE.md` with a provenance header naming the
   canonical source, the version, and the SHA-256 of the canonical body. A mismatched digest means the copy
   is stale: **re-copy it, never edit a copy.**
2. **Declare it.** Each repo's AI/developer context file (`CLAUDE.md` or `AI_CONTEXT.md`) states
   `authority-interface/1` and links the file, so any session picks it up on orientation.
3. **Test what you can assert.** Each repo carries at least one test pinning the invariants it can check
   locally. CorpID pins §3.8 (factors is a set; method not ordinal), §3.7 (derived fields absent from signed
   bytes), and §3.10 (no chain anchor claimed where none exists).
4. **Changing this contract** means bumping the version here, re-copying to every repo, and saying what
   moved in §8. A silent edit to a copy is the failure mode this section exists to prevent.

---

## 8. Status and changelog

**⚠️ Current conformance is partial, and saying so is part of the contract.**

| Item | State |
|---|---|
| E1 / E2 — publish AUTHORIZE / REVOKE on chain | ❌ **Not built.** CorpID holds Authorizations in SQLite and performs zero chain writes |
| E3 — read authority as-of | ❌ Not built on chain. CorpID answers it from its own database |
| E4 — resolve root | 🟡 Partial — Epistery binding exists, but the profile pointer points *at CorpID* |
| V1 — subject is an Identity | 🟡 Decided; enrolment not built |
| V2 — local signing | 🟡 Primitives exist (`secure-enclave-provider`, `tpm-provider`, `wallet`); the tool is not built |
| V3 — origin bundle carrying an Authorization reference | 🟡 `origin-bundle` exists; the reference is not defined |
| V4 — rivet add/remove | ✅ Exists in `identity-provider` |
| §3.8 one vocabulary | ✅ Unified across CorpID and the v1.6 roadmap |

**Until E1–E3 exist, no project may describe an Authorization as sovereign, chain-anchored, or verifiable
without Rootz.** CorpID's site and `/.well-known/corpid.json` carry an explicit `status_caveat` saying so.

### Changelog

- **`authority-interface/1`** — 2026-09-12. First version. Resolves the *delegation* (§1.1) and *rivet*
  (§1.2) collisions, fixes the shared vocabulary (§2), states ten invariants with their failure modes (§3),
  and defines the E1–E4 / V1–V4 consumption contract. Steven Sprague set the architecture — *sovereignty
  comes from the authorizations; validation is built by the chain, not by an app*; Claude (Opus 5) wrote it
  and audited the three repos for the collisions above.
