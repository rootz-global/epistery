import { describe, it, expect } from 'vitest';
import { keyExchangeMessage } from '../client/key-exchange-message.mjs';

describe('keyExchangeMessage — the one string a device signs to prove its key', () => {
  it('is the exact bytes every host and authority verifies', () => {
    expect(keyExchangeMessage({ address: '0xabc', challenge: '0x01' })).toBe('Epistery Key Exchange - 0xabc - 0x01');
  });
});
