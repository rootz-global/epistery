// The ONE definition of an epistery domain attachment — the domain's signature
// on an IDENTITY, recorded by that identity on its own contract.
//
// An identity that writes "epistery.com" into a public attribute has asserted a
// string. Anyone can write any domain there, so as evidence it is worth nothing —
// the same emptiness as a `_signature` block containing no signature. This is the
// proof that makes the attribute mean something: the domain's own wallet signs
// {contract, domain, ts}, and the identity stores THAT. A reader with the contract
// and nothing else recovers the signer, checks it against the address the domain
// publishes about itself, and is done. No registry is consulted, and nobody is
// asked to vouch for us.
//
// How it differs from the ORIGIN CERTIFICATE, which it deliberately mirrors:
//
//   origin certificate   domain signs a DEVICE   short-lived, presented per request
//   domain attachment    domain signs an IDENTITY durable, recorded on chain
//
// A certificate says "this device proved control here, a moment ago". An
// attachment says "this contract is attached to this domain, as of this date".
// The first is a live observation and must expire; the second is a dated fact and
// must not, because the record it lives in is permanent and re-signing it costs
// gas. Age is reported to whoever is deciding (ProofOfOrigin), never silently
// enforced here — a verifier that wants a freshness window passes maxAgeMs.
//
// Both halves are revocable by the side that owns them, which is what keeps this
// out of the shape the estate exists to remove. The identity can clear the
// attribute; the domain can rotate the wallet it publishes, which retires every
// attachment it ever signed. Neither party holds a key the other depends on, and
// no server supplies authority to either (NoLordOnTheHill).
//
// Wire shape: five lines joined by '\n', in this fixed order. Verifiers split on
// '\n' and require exactly length 5 with line 0 === the tag. Changing the order,
// the count, or the tag is a wire-breaking change for every signer and verifier at
// once — which is the intent.
//
//   0  'epistery-domain-attachment'   tag
//   1  v                              envelope version ('1')
//   2  contract                       the IdentityContract address, lowercase hex
//   3  domain                         the domain attaching it, lowercase, no port
//   4  ts                             unix milliseconds the domain signed it

export const DOMAIN_ATTACHMENT_TAG = 'epistery-domain-attachment';
export const DOMAIN_ATTACHMENT_VERSION = '1';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Normalized before the bytes are built, so a checksummed address and a lowercase
// one produce the SAME attachment and a verifier never guesses which casing was
// signed. Mirrors origin-certificate.mjs deliberately.
function normAddress(value, label) {
  const s = String(value ?? '').trim();
  if (!ADDRESS_RE.test(s)) throw new Error(`domain-attachment: ${label} must be a 0x-prefixed 40-hex address`);
  return s.toLowerCase();
}

function normDomain(value) {
  const s = String(value ?? '').trim().toLowerCase().replace(/\.$/, '').split(':')[0];
  if (!s) throw new Error('domain-attachment: domain is required');
  return s;
}

function normTs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('domain-attachment: ts must be a positive unix-millisecond value');
  return Math.floor(n);
}

/** The exact bytes a domain signs to attach one identity contract. */
export function domainAttachmentMessage({ contract, domain, ts }) {
  return [
    DOMAIN_ATTACHMENT_TAG,
    DOMAIN_ATTACHMENT_VERSION,
    normAddress(contract, 'contract'),
    normDomain(domain),
    String(normTs(ts)),
  ].join('\n');
}

/**
 * Issue an attachment. Called by the DOMAIN, with the domain's OWN wallet — never
 * a pool, a relay, or any wallet that speaks for someone else.
 *
 * The caller must already have proved it speaks for `contract` (the identity's
 * rivet, verified on chain). This signs what the domain decided to attach, and
 * deciding is the whole claim: a domain that issues one of these to anyone who
 * asks has signed a statement it cannot stand behind.
 *
 * @param {{contract:string, domain:string, ts?:number}} claim
 * @param {{signMessage:(m:string)=>Promise<string>}} domainWallet
 * @returns {Promise<{v:string, contract:string, domain:string, ts:number, signature:string}>}
 */
export async function issueDomainAttachment({ contract, domain, ts = Date.now() }, domainWallet) {
  if (!domainWallet?.signMessage) throw new Error('domain-attachment: a signing wallet is required');
  const claim = { contract: normAddress(contract, 'contract'), domain: normDomain(domain), ts: normTs(ts) };
  const signature = await domainWallet.signMessage(domainAttachmentMessage(claim));
  return { v: DOMAIN_ATTACHMENT_VERSION, ...claim, signature };
}

/**
 * Verify a recorded attachment. Returns a typed result rather than throwing, so a
 * caller can tell "no attachment" from "an attachment that does not hold" — the
 * distinction that matters when most identities simply have none yet.
 *
 * `expectDomainWallet` is the address the DOMAIN publishes as its own. Resolve it
 * from that domain, never from the record: an attachment checked against an
 * address stored beside it proves precisely nothing.
 *
 * `ageMs` is always returned, including on success, because how long ago a domain
 * attached an identity is a fact the decider is entitled to weigh.
 *
 * @returns {{ok:boolean, reason?:string, signer?:string, ageMs?:number, claim?:object}}
 */
// The estate runs two majors of ethers: v5 keeps `verifyMessage` on `ethers.utils`,
// v6 moved it to the top level. A verifier is handed whichever one its host has, so
// the shape is resolved here rather than by every caller — and a missing function is
// reported as "no ethers to verify with" instead of throwing deep inside a check.
function recoverWith(ethers) {
  const fn = ethers?.utils?.verifyMessage ?? ethers?.verifyMessage;
  return typeof fn === 'function' ? fn : null;
}

export function verifyDomainAttachment(att, { contract, domain, expectDomainWallet, now = Date.now(), maxAgeMs = null } = {}, ethers) {
  if (!att) return { ok: false, reason: 'absent' };
  const recover = recoverWith(ethers);
  if (!recover) return { ok: false, reason: 'no ethers provided to verify with' };
  if (att.v !== DOMAIN_ATTACHMENT_VERSION) return { ok: false, reason: `unsupported attachment version "${att.v}"` };
  if (!expectDomainWallet) return { ok: false, reason: 'no published domain wallet to check against' };

  let message, claim;
  try {
    claim = { contract: normAddress(att.contract, 'contract'), domain: normDomain(att.domain), ts: normTs(att.ts) };
    message = domainAttachmentMessage(claim);
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  // The attachment must be about the contract and the domain being asked about.
  // Skipping either check turns any valid attachment into a universal one.
  if (contract && claim.contract !== normAddress(contract, 'contract')) {
    return { ok: false, reason: 'attachment names a different contract', claim };
  }
  if (domain && claim.domain !== normDomain(domain)) {
    return { ok: false, reason: 'attachment names a different domain', claim };
  }

  const ageMs = now - claim.ts;
  // A future date is not clock skew to tolerate, it is a claim about a decision
  // that has not been taken. One minute absorbs ordinary skew.
  if (ageMs < -60_000) return { ok: false, reason: 'attachment is dated in the future', ageMs, claim };
  if (maxAgeMs !== null && ageMs > maxAgeMs) {
    return { ok: false, reason: `attachment is older than the caller allows (${Math.round(ageMs / 1000)}s)`, ageMs, claim };
  }

  let signer;
  try {
    signer = recover(message, att.signature);
  } catch (e) {
    return { ok: false, reason: `signature does not recover: ${e.message}`, ageMs, claim };
  }
  if (signer.toLowerCase() !== String(expectDomainWallet).toLowerCase()) {
    return { ok: false, reason: `signed by ${signer}, not the domain wallet ${expectDomainWallet}`, ageMs, claim };
  }
  return { ok: true, signer, ageMs, claim };
}
