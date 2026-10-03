import { describe, it, expect } from 'vitest';
import { keyExchangeMessage, serverResponseMessage, connectChallenge, parseConnectChallenge, isFreshTimestamp } from '../client/key-exchange-message.mjs';

describe('keyExchangeMessage — the one string a device signs to prove its key', () => {
  it('is the exact bytes every host and authority verifies', () => {
    expect(keyExchangeMessage({ address: '0xabc', challenge: '0x01' })).toBe('Epistery Key Exchange - 0xabc - 0x01');
  });
});

describe('serverResponseMessage — the one string a host signs back', () => {
  it('is the exact bytes the witness and the CLI verify against the host address', () => {
    expect(serverResponseMessage({ address: '0xhost', challenge: '0x02' })).toBe('Epistery Server Response - 0xhost - 0x02');
  });
});

describe('connectChallenge — a /connect challenge names its host and its moment', () => {
  it('round-trips, lowercases the nonce, and refuses what is not one', () => {
    const nonce = '0x' + 'AB'.repeat(32);
    const c = connectChallenge({ aud: 'epistery.com', ts: 1790900000000, nonce });
    expect(c).toBe(`epistery.com|1790900000000|${nonce}`);
    expect(parseConnectChallenge(c)).toEqual({ aud: 'epistery.com', ts: 1790900000000, nonce: nonce.toLowerCase() });
    expect(parseConnectChallenge('0x' + 'ab'.repeat(32))).toBeNull();
    expect(parseConnectChallenge('epistery.com|notatime|' + nonce)).toBeNull();
    expect(() => connectChallenge({ aud: '', ts: 1, nonce })).toThrow();
  });
  it('isFreshTimestamp is the one window: two minutes back, thirty seconds ahead', () => {
    const now = 1_000_000_000;
    expect(isFreshTimestamp(now - 119_000, now)).toBe(true);
    expect(isFreshTimestamp(now - 121_000, now)).toBe(false);
    expect(isFreshTimestamp(now + 29_000, now)).toBe(true);
    expect(isFreshTimestamp(now + 31_000, now)).toBe(false);
    expect(isFreshTimestamp(NaN, now)).toBe(false);
  });
});
