// The ONE definition of the epistery `Bot` authentication message.
//
// Every party that signs a bot-authenticated request — the CLI, the MCP stdio
// bridge, derived agent wallets — and the server middleware that verifies it
// MUST build these exact bytes.
//
// This module deliberately mirrors `storage-message.mjs`, which already binds
// method + contract + subpath + body hash + timestamp into the bytes a storage
// write signs. Bot auth predates that convention and bound none of it: it
// signed a fixed banner string plus a timestamp, so the signature proved that
// an address had signed *something*, not that it had authorised *this request*.
// Same house pattern, applied to the auth header.
//
// Pure ESM, zero dependencies, no Node-only APIs — so the identical module
// imports in a Node server, in the CLI, and in a browser.
//
// Wire shape: eight lines joined by '\n', in this fixed order. Verifiers split
// on '\n' and require exactly length 8 with line 0 === 'epistery-bot-auth'.
// Changing the order, the count, or the tag is a wire-breaking change for every
// signer and verifier at once — which is the intent: an old signer must fail at
// the header, never degrade silently.
//
//   0  'epistery-bot-auth'   tag
//   1  v                     envelope version ('1')
//   2  method                HTTP method, uppercased
//   3  uri                   path + query, exactly as sent on the wire
//   4  aud                   audience: the host this request is for (no port)
//   5  bodyHashHex           sha256 of the raw request body, lowercase hex.
//                            The empty-body value is the sha256 of zero bytes,
//                            not the empty string — see EMPTY_BODY_SHA256.
//   6  ts                    unix milliseconds the envelope was created
//   7  nonce                 single-use random value, hex

export const BOT_AUTH_TAG = 'epistery-bot-auth';
export const BOT_AUTH_VERSION = '1';

/** sha256 of zero bytes. A request with no body still commits to that fact. */
export const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Build the exact bytes a bot-authenticated request signs.
 *
 * @param {object}  p
 * @param {string}  p.method       HTTP method (case-insensitive; uppercased here)
 * @param {string}  p.uri          path + query as sent (e.g. '/mcp' or '/x?y=1')
 * @param {string}  p.aud          target host, no port (e.g. 'geist.social')
 * @param {string}  p.bodyHashHex  lowercase hex sha256 of the raw body
 * @param {number}  p.ts           unix ms
 * @param {string}  p.nonce        hex nonce, unique per envelope
 * @returns {string}
 */
export function botAuthMessage({ method, uri, aud, bodyHashHex, ts, nonce }) {
  return [
    BOT_AUTH_TAG,
    BOT_AUTH_VERSION,
    String(method).toUpperCase(),
    uri,
    aud,
    bodyHashHex,
    String(ts),
    nonce,
  ].join('\n');
}

/**
 * Normalise a host to the `aud` value: lowercase, port stripped.
 * A signature made for `example.com` must not verify on `other.example.com`,
 * and must survive the request arriving on :443 vs :8080.
 */
export function audienceFor(host) {
  if (!host) return '';
  return String(host).toLowerCase().split(':')[0];
}

/**
 * Parse and shape-check a decoded `Bot` payload. Returns the envelope or null.
 * Shape only — no crypto, no clock, no replay. Those are the verifier's job.
 */
export function parseBotEnvelope(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;
  const { v, address, signature, method, uri, aud, bodyHash, ts, nonce } = decoded;
  if (v !== BOT_AUTH_VERSION) return null;
  if (typeof address !== 'string' || !address) return null;
  if (typeof signature !== 'string' || !signature) return null;
  if (typeof method !== 'string' || !method) return null;
  if (typeof uri !== 'string' || !uri) return null;
  if (typeof aud !== 'string' || !aud) return null;
  if (typeof bodyHash !== 'string' || !/^[0-9a-f]{64}$/.test(bodyHash)) return null;
  if (!Number.isInteger(ts)) return null;
  if (typeof nonce !== 'string' || !/^[0-9a-f]{16,}$/.test(nonce)) return null;
  return { v, address, signature, method, uri, aud, bodyHash, ts, nonce };
}

/** The message bytes for an already-parsed envelope. */
export function messageForEnvelope(env) {
  return botAuthMessage({
    method: env.method,
    uri: env.uri,
    aud: env.aud,
    bodyHashHex: env.bodyHash,
    ts: env.ts,
    nonce: env.nonce,
  });
}
