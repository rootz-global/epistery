// The ONE definition of an epistery domain manifest's signed bytes — the
// construction a stranger rebuilds to check that a domain signed its own
// /.well-known/ai.
//
// This lives in the package rather than in the server that happens to publish
// one, because the verifier is not the publisher: scan checks manifests from
// domains it has never met, and a second copy of this construction is a thing
// that can disagree with the first. The document itself is not here — what a
// domain says about itself is its own business, and only the bytes it signs and
// the way they are checked are shared.
//
// WHAT IS SIGNED. A tagged, newline-joined message, the same house pattern as the
// storage, bot-auth, origin-certificate and domain-attachment messages, so a
// signature taken here can never be replayed as some other kind of statement:
//
//   epistery-domain-manifest\n1\n<domain>\n<contentHash>
//
// WHAT THE HASH COVERS. The whole document with `_signature` and `generated`
// removed and every key sorted, sha256, hex. `generated` is excluded because it
// moves on every request; excluding it is what lets one signature stay valid
// across fetches. Change how this hashes and every manifest reads as tampered.

import crypto from 'crypto';

export const MANIFEST_TAG = 'epistery-domain-manifest';
export const MANIFEST_VERSION = '1';
export const SIGNATURE_METHOD = 'epistery-domain-v2';

// Recursive key sort. Mirrors epistery-host's AIDiscovery and scan's ingestion so
// all three agree on the canonical form of the same document.
function sortKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortKeys(obj[k]); return acc; }, {});
  }
  return obj;
}

export function contentHash(doc) {
  const clone = JSON.parse(JSON.stringify(doc));
  delete clone._signature;
  delete clone.generated;
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(sortKeys(clone))).digest('hex');
}

/** The exact bytes the domain wallet signs. Stated in the manifest as `signedOver`. */
export function manifestMessage({ domain, hash }) {
  return [MANIFEST_TAG, MANIFEST_VERSION, String(domain).toLowerCase(), hash].join('\n');
}

/**
 * Verify a manifest: recompute the hash, rebuild the message, recover the signer.
 * Returns a typed result — `signed:false` means no signature was offered, which is
 * a v1 manifest, not a forged one.
 */
// The estate runs two majors of ethers: v5 keeps `verifyMessage` on `ethers.utils`,
// v6 moved it to the top level. A verifier is handed whichever one its host has, so
// the shape is resolved here rather than by every caller — and a missing function is
// reported as "no ethers to verify with" instead of throwing deep inside a check.
function recoverWith(ethers) {
  const fn = ethers?.utils?.verifyMessage ?? ethers?.verifyMessage;
  return typeof fn === 'function' ? fn : null;
}

export function verifyManifest(doc, ethers) {
  const sig = doc?._signature;
  if (!sig) return { ok: false, signed: false, reason: 'no _signature block' };
  if (!sig.signature) return { ok: false, signed: false, reason: `method "${sig.method}" carries a content hash but no signature` };

  const hash = contentHash(doc);
  if (hash !== sig.contentHash) return { ok: false, signed: true, reason: `content hash mismatch (computed ${hash})` };

  const domain = doc?.identity?.domain;
  const recover = recoverWith(ethers);
  if (!recover) return { ok: false, signed: true, reason: 'no ethers provided to verify with' };
  let signer;
  try {
    signer = recover(manifestMessage({ domain, hash }), sig.signature);
  } catch (e) {
    return { ok: false, signed: true, reason: `signature does not recover: ${e.message}` };
  }
  if (signer.toLowerCase() !== String(sig.digitalName || '').toLowerCase()) {
    return { ok: false, signed: true, reason: `signed by ${signer}, not the declared ${sig.digitalName}` };
  }
  return { ok: true, signed: true, signer, domain };
}
