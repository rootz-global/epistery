import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
// @ts-ignore - plain browser module; its window/navigator uses are inside methods or guarded
import { Wallet, RivetWallet, Web3Wallet, FidoWallet } from '../client/wallet.js';

// Every data-capable wallet kind derives the TreeKEM leaf secret itself. The
// FIDO kind said canPeerEncrypt and inherited the base refusal, so a passkey
// device could seal to a peer but never open a session group.
describe('wallet kinds — the leaf-decap capability', () => {
  it('every kind that says canPeerEncrypt implements computeSharedSecret itself, not the base refusal', () => {
    for (const K of [RivetWallet, Web3Wallet, FidoWallet]) {
      expect(K.prototype.computeSharedSecret).not.toBe(Wallet.prototype.computeSharedSecret);
    }
  });

  it('a FIDO wallet, once unlocked, derives the same shared secret as the peer', async () => {
    const mine = ethers.Wallet.createRandom();
    const peer = ethers.Wallet.createRandom();
    const w = new FidoWallet();
    w.address = mine.address; w.publicKey = mine.publicKey;
    w._priv = mine.privateKey;   // what the PRF ceremony leaves in the session cache
    const ours = await w.computeSharedSecret(peer.publicKey, ethers);
    const theirs = ethers.utils.arrayify(new ethers.utils.SigningKey(peer.privateKey).computeSharedSecret(mine.publicKey));
    expect(Buffer.from(ours).toString('hex')).toBe(Buffer.from(theirs).toString('hex'));
    expect(ours.length).toBe(32);
  });
});
