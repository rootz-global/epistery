// The ONE definition of the epistery /storage signed-write message.
//
// Every party that signs a storage write — the browser rivet, the server
// host-operator, and the derived member/bot/agent wallets — and the relay that
// verifies it MUST build these exact bytes. Historically the string was copied
// into three places (the app's server relay-client, the browser client, and the
// relay's storage-auth), each carrying a "MUST match the others EXACTLY" comment
// — precisely the byte-drift hazard that comment admits. This module is that
// single home: import it, never re-inline it.
//
// Pure ESM, zero dependencies, no Node-only APIs — so the identical module
// imports in a Node server and in a browser (served as a static asset).
//
// Wire shape: six lines joined by '\n', in this fixed order. The relay's
// storage-auth splits on '\n' and requires exactly length 6 with line 0 ===
// 'epistery-storage-write'. Changing the order, the count, or the tag is a
// wire-breaking change for every signer and verifier at once.
export function storageWriteMessage({ method, contract, subpath, bodyHashHex, ts }) {
  return ['epistery-storage-write', method, contract, subpath, bodyHashHex, String(ts)].join('\n');
}
