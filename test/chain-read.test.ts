import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-ignore - plain .mjs module, no types
import { chainReader, isChainReadFailure } from '../client/chain-read.mjs';

// Attestation reads (EpisteryChainReads, Proposal A): answered by an owned node or
// not at all. A fake node decodes real calldata, so the reader's encoding and the
// ethers error shapes it classifies are the real ones.

const CONTRACT = ethers.Wallet.createRandom().address;
const SESSION = 'recipes';
const RIVET = ethers.Wallet.createRandom().address;
const WRITER = ethers.Wallet.createRandom().address;
const STRANGER = ethers.Wallet.createRandom().address;
const iface = new ethers.utils.Interface([
  'function isAuthorized(address) view returns (bool)',
  'function getRivets() view returns (address[])',
  'function roleOf(string section, address account) view returns (uint8)',
]);

// mode: 'ok' answers; 'lie' says everyone is a rivet; 'hang' never answers; 'down' HTTP 503; 'forbidden' HTTP 403 (the Infura settings shape)
function fakeNode(mode: () => string) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = mode();
      if (m === 'hang') return;   // a jammed node: takes the request, never answers
      if (m !== 'ok' && m !== 'lie') { res.writeHead(m === 'down' ? 503 : 403); return res.end('{"error":"no"}'); }
      const rq = JSON.parse(body);
      const reply = (result: any) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: rq.id, result })); };
      if (rq.method === 'eth_chainId') return reply('0x89');
      const { to, data } = rq.params[0];
      if (to.toLowerCase() !== CONTRACT.toLowerCase()) return reply('0x');   // an EOA: no code, no data
      const tx = iface.parseTransaction({ data });
      const a = (x: string) => x.toLowerCase();
      if (tx.name === 'isAuthorized') return reply(iface.encodeFunctionResult('isAuthorized', [m === 'lie' || a(tx.args[0]) === a(RIVET)]));
      if (tx.name === 'getRivets') return reply(iface.encodeFunctionResult('getRivets', [[RIVET]]));
      return reply(iface.encodeFunctionResult('roleOf', [tx.args[0] === SESSION && a(tx.args[1]) === a(WRITER) ? 2 : 0]));
    });
  });
  return server;
}

const modes = ['ok', 'ok', 'ok'];
const servers: http.Server[] = [];
const urls: string[] = [];
const listen = (sv: http.Server) => new Promise<string>((r) => sv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(sv.address() as any).port}/`)));

beforeAll(async () => {
  for (let i = 0; i < 3; i++) { const sv = fakeNode(() => modes[i]); servers.push(sv); urls.push(await listen(sv)); }
});
afterAll(() => servers.forEach((sv) => { (sv as any).closeAllConnections?.(); sv.close(); }));

const set = (...m: string[]) => m.forEach((x, i) => (modes[i] = x));
const reader = (n: number, quorum: number | null = null, timeoutMs = 3000) => chainReader({ rpcs: urls.slice(0, n), quorum, chainId: 137, ethers, ttlMs: 0, timeoutMs });

describe('chainReader — k-of-n, like a multisig', () => {
  it('one node, quorum 1 (today): answers rivet, writer, stranger', async () => {
    set('ok');
    const r = reader(1);
    expect(r.quorum).toBe(1);
    expect(await r.isRivet(CONTRACT, RIVET)).toBe(true);
    expect(await r.mayCommit(CONTRACT, SESSION, WRITER)).toBe(true);
    expect(await r.mayCommit(CONTRACT, SESSION, STRANGER)).toBe(false);
  });

  it('an EOA among the contract rivets is an answer ("no"), not a read failure', async () => {
    set('ok');
    expect(await reader(1).isRivet(CONTRACT, STRANGER)).toBe(false);
  });

  it('three nodes default to 2 of 3', () => {
    expect(reader(3).quorum).toBe(2);
  });

  it('2 of 3: a node that is down costs nothing', async () => {
    set('down', 'ok', 'ok');
    expect(await reader(3).mayCommit(CONTRACT, SESSION, RIVET)).toBe(true);
  });

  it('2 of 3: one lying node neither blocks nor decides', async () => {
    set('lie', 'ok', 'ok');
    expect(await reader(3).mayCommit(CONTRACT, SESSION, STRANGER)).toBe(false);
    set('ok', 'lie', 'ok');
    expect(await reader(3).mayCommit(CONTRACT, SESSION, RIVET)).toBe(true);
  });

  it('2 of 3: a jammed (hanging) node does not hold the read — it settles on the two', async () => {
    set('hang', 'ok', 'ok');
    const t = Date.now();
    expect(await reader(3, null, 10000).mayCommit(CONTRACT, SESSION, RIVET)).toBe(true);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('2 of 3: two colluding nodes decide — the stated limit', async () => {
    set('lie', 'lie', 'ok');
    expect(await reader(3).mayCommit(CONTRACT, SESSION, STRANGER)).toBe(true);
  });

  it('a strict host (3 of 3): one node down is CHAIN_UNREACHABLE, one lying is CHAIN_DISAGREES', async () => {
    set('down', 'ok', 'ok');
    await expect(reader(3, 3).mayCommit(CONTRACT, SESSION, RIVET)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' });
    set('lie', 'ok', 'ok');
    await expect(reader(3, 3).mayCommit(CONTRACT, SESSION, STRANGER)).rejects.toMatchObject({ code: 'CHAIN_DISAGREES' });
  });

  it('a loose host (1 of 2): two answers both reaching the quorum is a refusal, not a choice', async () => {
    set('lie', 'ok');
    await expect(reader(2, 1).mayCommit(CONTRACT, SESSION, STRANGER)).rejects.toMatchObject({ code: 'CHAIN_DISAGREES' });
  });

  it('no node answering in time is CHAIN_UNREACHABLE — never a "no", never a guess', async () => {
    set('hang');
    await expect(reader(1, null, 300).mayCommit(CONTRACT, SESSION, RIVET)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' });
    set('down', 'forbidden', 'down');
    await expect(reader(3).mayCommit(CONTRACT, SESSION, RIVET)).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE' });
  });

  it('refuses to exist without a node, or with a quorum outside 1..n', () => {
    expect(() => chainReader({ rpcs: [], chainId: 137, ethers })).toThrow(/owned node/);
    expect(() => chainReader({ rpcs: urls, quorum: 4, chainId: 137, ethers })).toThrow(/quorum/);
    expect(() => chainReader({ rpcs: urls, quorum: 0, chainId: 137, ethers })).toThrow(/quorum/);
  });
});

describe('isChainReadFailure — the one classifier', () => {
  it('transport errors are failures', () => {
    for (const code of ['SERVER_ERROR', 'TIMEOUT', 'NETWORK_ERROR']) expect(isChainReadFailure({ code })).toBe(true);
  });
  it('a CALL_EXCEPTION with no revert bytes is a failure (the fabricated shape)', () => {
    expect(isChainReadFailure({ code: 'CALL_EXCEPTION', data: '0x' })).toBe(true);
    expect(isChainReadFailure({ code: 'CALL_EXCEPTION', data: '0x08c379a0', error: { status: 403 } })).toBe(true);
  });
  it('a revert with its bytes is an answer', () => {
    expect(isChainReadFailure({ code: 'CALL_EXCEPTION', data: '0x08c379a0' })).toBe(false);
  });
});

describe('attestationConfig — owned nodes and quorum from config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-attest-'));
  const saved = { HOME: process.env.HOME, URL: process.env.EPISTERY_CONFIG_URL };
  const write = (ini: string) => { fs.mkdirSync(path.join(home, '.epistery'), { recursive: true }); fs.writeFileSync(path.join(home, '.epistery', 'config.ini'), ini); };
  beforeAll(() => { process.env.HOME = home; delete process.env.EPISTERY_CONFIG_URL; });
  afterAll(() => { process.env.HOME = saved.HOME; if (saved.URL) process.env.EPISTERY_CONFIG_URL = saved.URL; });

  it('reads attest[] and quorum from the chain section, by alias', async () => {
    write('[chains.polygon]\nattest[] = https://node1.example/\nattest[] = https://node2.example/\nattest[] = https://node3.example/\nquorum = 2\n');
    const { attestationConfig } = await import('../dist/chains/index.js');
    expect(await attestationConfig(137)).toEqual({ rpcs: ['https://node1.example/', 'https://node2.example/', 'https://node3.example/'], quorum: 2 });
  });

  it('quorum unset is null — the reader takes a majority', async () => {
    write('[chains.polygon]\nattest[] = https://node1.example/\n');
    const { attestationConfig } = await import('../dist/chains/index.js');
    expect((await attestationConfig(137)).quorum).toBe(null);
  });

  it('a quorum above the node count throws', async () => {
    write('[chains.polygon]\nattest[] = https://node1.example/\nquorum = 2\n');
    const { attestationConfig } = await import('../dist/chains/index.js');
    await expect(attestationConfig(137)).rejects.toThrow(/quorum/);
  });

  it('no node configured throws — no fallthrough to a public endpoint', async () => {
    write('[provider]\npublicRpc = https://public.example/\n');
    const { attestationConfig } = await import('../dist/chains/index.js');
    await expect(attestationConfig(137)).rejects.toThrow(/No attestation node/);
  });
});
