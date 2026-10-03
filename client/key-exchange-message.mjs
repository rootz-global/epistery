// The ONE definition of the key-exchange message a device signs to prove a key
// to a host (POST /connect) or to the config authority (/auth/verify): the bytes
// the signer signs are the bytes the verifier rebuilds. Was hand-built in five
// places; import it, never re-inline it. Pure ESM, browser- and Node-importable.
export function keyExchangeMessage({ address, challenge }) {
  return `Epistery Key Exchange - ${address} - ${challenge}`;
}

/**
 * The message a host signs to prove its identity back to the device: its own
 * address and the challenge it minted. Verified by the browser witness and the
 * CLI against the host's address; built by the host. One string, here.
 */
export function serverResponseMessage({ address, challenge }) {
  return `Epistery Server Response - ${address} - ${challenge}`;
}

/**
 * The challenge a device mints for POST /connect. Not random bytes alone: it
 * names the host it is for (`aud`, as bot-auth's audienceFor shapes it), the
 * moment it was made (`ts`, ms since the epoch) and a nonce. All three sit
 * inside the one message the device signs (keyExchangeMessage), so the host can
 * refuse a handshake minted for another host, an old one, or one it has seen —
 * a captured /connect request used to open a session as that device forever.
 * The message's bytes are unchanged; only what the challenge SAYS is. (The config
 * authority's /auth/verify issues its own challenge and never sees this shape.)
 */
export function connectChallenge({ aud, ts, nonce }) {
  if (!aud || !Number.isFinite(ts) || !nonce) throw new Error('connectChallenge: aud, ts and nonce are required');
  return `${aud}|${Math.floor(ts)}|${nonce}`;
}

/** `{ aud, ts, nonce }` from a connect challenge, or null when it is not one. */
export function parseConnectChallenge(challenge) {
  if (typeof challenge !== 'string') return null;
  const m = /^([a-z0-9.-]+)\|(\d{1,16})\|(0x[0-9a-fA-F]{64})$/.exec(challenge);
  return m ? { aud: m[1], ts: Number(m[2]), nonce: m[3].toLowerCase() } : null;
}

/**
 * Whether a signed timestamp is current: no older than `maxAgeMs`, no further
 * ahead of the clock than `maxSkewMs`. The one freshness rule for a signed
 * request — bot auth and the /connect handshake apply the same window.
 */
export const SIGNED_MAX_AGE_MS = 120_000;
export const SIGNED_MAX_SKEW_MS = 30_000;
export function isFreshTimestamp(ts, now = Date.now(), { maxAgeMs = SIGNED_MAX_AGE_MS, maxSkewMs = SIGNED_MAX_SKEW_MS } = {}) {
  const age = now - Number(ts);
  return Number.isFinite(age) && age <= maxAgeMs && age >= -maxSkewMs;
}
