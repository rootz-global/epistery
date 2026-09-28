// How a caller reaches the chain for a read — the ONE copy (EpisteryChainReads,
// Proposal A). Browser-servable and Node-importable, like storage-message.mjs: it
// takes ethers v5 from the caller or from globalThis.
//
// Two things live here:
//
//   isChainReadFailure(e) — did the read FAIL, or did the chain ANSWER? A failed
//     read means "ask again"; a false or a revert means "no". Conflating them is
//     what let a provider outage read as a rejection (connect.mjs, PR #37).
//
//   chainReader({ rpcs, chainId }) — ATTESTATION reads: facts a caller acts on
//     as verified (who may seat a device in a group). `rpcs` are the chain's
//     attestation endpoints — OWNED nodes only (attestationRpcs() in the chain
//     registry). An answer is asserted k-of-n, like a multisig: it stands when
//     `quorum` nodes give it (default a majority — 1 of 1, 2 of 3), so one jammed
//     node neither blocks the read nor decides it. Otherwise the read is refused —
//     CHAIN_DISAGREES or CHAIN_UNREACHABLE — never guessed, and never answered by a
//     foreign gateway. Today the operator runs the only node; each independent node
//     added is one more that a lie must get past.
//
// The rules mirror the relay's storage-auth, so a member and the relay reach the
// same verdict from the same chain:
//   rivet : isAuthorized(addr) on the contract, or — an identity admitted as a
//           signer vouching for its own rivet — any contract in getRivets() whose
//           isAuthorized(addr) is true
//   role  : roleOf(section, addr); an identity that vouches for addr lends it its
//           own role (the credential's `identity`)

// ethers v5 pitfall: when an endpoint returns a non-result (an HTTP 403, a rate
// limit) ethers does not surface a transport error for an eth_call — it fabricates
// a CALL_EXCEPTION with data "0x", indistinguishable at a glance from a revert. That
// shape (no revert bytes, and/or a transport error nested in e.error) is a read
// failure, not an answer.
export function isChainReadFailure(e) {
  if (!e) return false;
  if (e.code === "SERVER_ERROR" || e.code === "TIMEOUT" || e.code === "NETWORK_ERROR") {
    return true;
  }
  if (e.code === "CALL_EXCEPTION") {
    const noRevertData = e.data == null || e.data === "0x";
    const inner = e.error || {};
    const transportUnderneath =
      inner.code === "SERVER_ERROR" ||
      inner.code === "TIMEOUT" ||
      inner.code === "NETWORK_ERROR" ||
      typeof inner.status === "number";
    if (noRevertData || transportUnderneath) return true;
  }
  return false;
}

const ABI = [
  "function isAuthorized(address) view returns (bool)",
  "function getRivets() view returns (address[])",
  "function roleOf(string section, address account) view returns (uint8)",
];
const ROLE_WRITE = 2;
const lc = (a) => String(a || "").toLowerCase();
const host = (url) => { try { return new URL(url).host; } catch { return String(url); } };

export function chainReader({ rpcs, quorum = null, chainId, ethers = globalThis.ethers, ttlMs = 10 * 60 * 1000, timeoutMs = 15000 } = {}) {
  const endpoints = [...new Set((rpcs || []).filter(Boolean))];
  if (!endpoints.length) {
    throw new Error("chainReader: no attestation endpoint — an attestation read is answered by an owned node or not at all");
  }
  if (!ethers?.providers) throw new Error("chainReader: ethers v5 is required");
  // Unset: a majority of the configured nodes (1 of 1, 2 of 3). A host may be
  // stricter or looser; outside 1..n is a misconfiguration.
  quorum = quorum == null ? Math.floor(endpoints.length / 2) + 1 : Number(quorum);
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > endpoints.length) {
    throw new Error(`chainReader: quorum ${quorum} is not between 1 and the ${endpoints.length} configured node(s)`);
  }
  const network = chainId ? Number(chainId) : undefined;
  const providers = endpoints.map((url) => ({ url, provider: new ethers.providers.StaticJsonRpcProvider(url, network) }));
  const iface = new ethers.utils.Interface(ABI);
  const cache = new Map();

  // One eth_call, asserted k-of-n like a multisig: every node is asked at once, and
  // an answer stands when `quorum` nodes give it. The read settles the moment the
  // outcome is decided, so a jammed node — one that hangs, errors, or lies — cannot
  // hold it hostage while enough others agree. Refused, never guessed:
  //   CHAIN_DISAGREES   two different answers both reached the quorum (only possible
  //                     with a quorum at or below half), or too many answers differ
  //                     for any to reach it
  //   CHAIN_UNREACHABLE too few nodes answered at all
  // An answer is the result hex, or null when the chain answered "nothing" (a revert
  // with its reason, or no contract at the address).
  function call(to, data) {
    return new Promise((resolve, reject) => {
      const votes = new Map();   // answer → count
      const failures = [];
      let pending = providers.length, done = false;
      const refuse = (code, msg) => { const e = new Error(msg); e.code = code; done = true; clearTimeout(timer); reject(e); };
      const decide = () => {
        if (done) return;
        const reached = [...votes].filter(([, n]) => n >= quorum);
        if (reached.length > 1) return refuse("CHAIN_DISAGREES", `chain nodes disagree, and more than one answer reached ${quorum} of ${providers.length} — refusing rather than choosing`);
        // Decided once one answer has the quorum and no other answer — one already
        // given, or one from a node not yet heard — can still reach it.
        if (reached.length === 1 && pending < quorum && [...votes].every(([v, n]) => v === reached[0][0] || n + pending < quorum)) {
          done = true; clearTimeout(timer); return resolve(reached[0][0] === "null" ? null : reached[0][0]);
        }
        const best = Math.max(0, ...votes.values());
        if (best + pending >= quorum) return;   // still possible
        const answered = [...votes.values()].reduce((a, n) => a + n, 0);
        if (answered + pending < quorum) return refuse("CHAIN_UNREACHABLE", `${answered} of ${providers.length} chain nodes answered, ${quorum} needed (${failures.join("; ") || "no answer in time"})`);
        return refuse("CHAIN_DISAGREES", `chain nodes disagree — no answer reached ${quorum} of ${providers.length}`);
      };
      const timer = setTimeout(() => { if (!done) { pending = 0; failures.push(`no answer within ${timeoutMs}ms`); decide(); } }, timeoutMs);
      for (const { url, provider } of providers) {
        provider.call({ to, data }).then(
          (out) => ({ answer: out === "0x" ? null : out }),
          (e) => (isChainReadFailure(e) ? { failure: `${host(url)} ${e.reason || e.code}` } : { answer: null }),   // a revert is an answer: no
        ).then((o) => {
          if (done) return;
          pending -= 1;
          if ("failure" in o) failures.push(o.failure);
          else { const k = String(o.answer).toLowerCase(); votes.set(k, (votes.get(k) || 0) + 1); }
          decide();
        });
      }
    });
  }
  async function read(to, fn, args) {
    const out = await call(to, iface.encodeFunctionData(fn, args));
    if (out == null || out === "0x") return null;
    return iface.decodeFunctionResult(fn, out)[0];
  }
  const cached = async (key, compute) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await compute();
    cache.set(key, { at: Date.now(), value });
    return value;
  };

  async function isRivet(contract, addr) {
    return cached(`rivet|${lc(contract)}|${lc(addr)}`, async () => {
      if (await read(contract, "isAuthorized", [addr])) return true;
      for (const entry of (await read(contract, "getRivets", [])) || []) {
        if (lc(entry) === lc(contract)) continue;
        if (await read(entry, "isAuthorized", [addr])) return true;
      }
      return false;
    });
  }

  async function roleOf(contract, section, addr) {
    return cached(`role|${lc(contract)}|${section}|${lc(addr)}`, async () => Number((await read(contract, "roleOf", [section, addr])) || 0));
  }

  // May `signer` commit to this session's group? What the relay requires of a
  // commit, read by the caller itself.
  async function mayCommit(contract, section, signer, identity = null) {
    if (await isRivet(contract, signer)) return true;
    if ((await roleOf(contract, section, signer)) >= ROLE_WRITE) return true;
    if (identity && lc(identity) !== lc(signer) && (await read(identity, "isAuthorized", [signer]))) {
      return (await roleOf(contract, section, identity)) >= ROLE_WRITE;
    }
    return false;
  }

  return { isRivet, roleOf, mayCommit, endpoints, quorum };
}
