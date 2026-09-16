// The domain attachment: the domain's signature on an identity contract.
//
//   node test/domain-attachment.test.mjs

import { createRequire } from 'module';
import {
  domainAttachmentMessage, issueDomainAttachment, verifyDomainAttachment,
  DOMAIN_ATTACHMENT_TAG, DOMAIN_ATTACHMENT_VERSION,
} from '../client/domain-attachment.mjs';

const require = createRequire(import.meta.url);
const ethers = require('ethers');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ok  ' + n); };
const bad = (n, got) => { fail++; console.log('  FAIL ' + n + (got !== undefined ? ' -> ' + JSON.stringify(got) : '')); };
const check = (c, n, got) => (c ? ok(n) : bad(n, got));

const domainWallet = ethers.Wallet.createRandom();
const other = ethers.Wallet.createRandom();
const CONTRACT = '0x07AADcC18Ad66385e6ad2f42f5c04d960C08fA28';
const DOMAIN = 'epistery.com';

const att = await issueDomainAttachment({ contract: CONTRACT, domain: DOMAIN }, domainWallet);
check(att.v === DOMAIN_ATTACHMENT_VERSION && att.contract === CONTRACT.toLowerCase() && att.domain === DOMAIN,
  'issue normalizes the claim', att);

const base = { contract: CONTRACT, domain: DOMAIN, expectDomainWallet: domainWallet.address };
let r = verifyDomainAttachment(att, base, ethers);
check(r.ok && r.signer.toLowerCase() === domainWallet.address.toLowerCase(), 'a real attachment verifies', r);
check(typeof r.ageMs === 'number', 'age is reported on success — a fact for the decider', r.ageMs);

// The bytes are the house shape: five lines, tag first.
const lines = domainAttachmentMessage({ contract: CONTRACT, domain: DOMAIN, ts: 1 }).split('\n');
check(lines.length === 5 && lines[0] === DOMAIN_ATTACHMENT_TAG && lines[1] === DOMAIN_ATTACHMENT_VERSION,
  'the signed bytes are five lines, tagged', lines);

// Casing must not change the bytes.
check(domainAttachmentMessage({ contract: CONTRACT.toLowerCase(), domain: 'EPISTERY.COM', ts: 1 }) ===
      domainAttachmentMessage({ contract: CONTRACT, domain: DOMAIN, ts: 1 }),
  'checksummed and lowercase produce the same bytes');
check(verifyDomainAttachment(att, { ...base, contract: CONTRACT.toLowerCase() }, ethers).ok,
  'verification accepts either casing of the contract');

// Every substitution a forger would try.
check(!verifyDomainAttachment(att, { ...base, expectDomainWallet: other.address }, ethers).ok,
  'refused when checked against a different domain wallet');
check(!verifyDomainAttachment(att, { ...base, contract: other.address }, ethers).ok,
  'refused when asked about a different contract');
check(!verifyDomainAttachment(att, { ...base, domain: 'evil.example' }, ethers).ok,
  'refused when asked about a different domain');
check(!verifyDomainAttachment({ ...att, domain: 'evil.example' }, { ...base, domain: 'evil.example' }, ethers).ok,
  'a re-labelled attachment does not verify against its own new label');
check(!verifyDomainAttachment({ ...att, ts: att.ts + 1000 }, base, ethers).ok, 'a moved date breaks the signature');

// An attachment signed by someone who is not the domain.
const forged = await issueDomainAttachment({ contract: CONTRACT, domain: DOMAIN }, other);
check(!verifyDomainAttachment(forged, base, ethers).ok, 'a stranger cannot attach an identity to a domain');

// Absence, shape and version are distinguishable from failure.
check(verifyDomainAttachment(null, base, ethers).reason === 'absent', 'absent is its own answer');
check(!verifyDomainAttachment({ ...att, v: '2' }, base, ethers).ok, 'an unknown version is refused');
check(verifyDomainAttachment(att, { ...base, expectDomainWallet: null }, ethers).reason?.includes('no published domain wallet'),
  'no published wallet is named as the reason, not a silent false');

// Dates: durable by default, bounded only when the caller asks.
const old = await issueDomainAttachment({ contract: CONTRACT, domain: DOMAIN, ts: Date.now() - 400 * 24 * 3600 * 1000 }, domainWallet);
check(verifyDomainAttachment(old, base, ethers).ok, 'an old attachment still verifies — age is reported, not enforced');
check(!verifyDomainAttachment(old, { ...base, maxAgeMs: 24 * 3600 * 1000 }, ethers).ok,
  'a caller that wants freshness gets it by asking');
const future = await issueDomainAttachment({ contract: CONTRACT, domain: DOMAIN, ts: Date.now() + 10 * 60_000 }, domainWallet);
check(!verifyDomainAttachment(future, base, ethers).ok, 'a future date is refused');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
