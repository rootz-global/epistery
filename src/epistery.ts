import { KeyExchangeRequest, KeyExchangeResponse } from './utils/index.js';
import { ethers } from 'ethers';
import { loadClientModule } from './utils/clientModule';

/**
 * The signer a host answers a key exchange with: the domain's connected wallet
 * (`epistery.signer`), never a key rebuilt from the mnemonic at the call site.
 */
export interface HostSigner {
  address: string;
  publicKey: string;
  signMessage(message: string): Promise<string>;
}

/**
 * What the route hands the handshake to hold a device's challenge to: the host
 * it is for (bot-auth's audienceFor of the request host), a clock, and the one
 * atomic nonce claim (`claim(nonce, expiresAtMs)`, the bot-auth store).
 */
export interface ConnectGuard {
  audience: string;
  now?: number;
  claimNonce: (nonce: string, expiresAtMs: number) => boolean | Promise<boolean>;
}

export class Epistery {
  private static isInitialized: boolean = false;

  constructor() { }

  public static async initialize(): Promise<void> {
    if (Epistery.isInitialized)
      return;

    Epistery.isInitialized = true;
  }

  /**
   * The device's half of /connect, checked, and the host's half, signed.
   *
   * Proof of signer: the message names signerAddress, and the recovered
   * address from `signature` must equal it. A contract claim (if any) is
   * verified separately by the route on chain — not here.
   */
  public static async handleKeyExchange(request: KeyExchangeRequest, signer: HostSigner, guard?: ConnectGuard): Promise<KeyExchangeResponse | null> {
    try {
      const { keyExchangeMessage, serverResponseMessage, parseConnectChallenge, isFreshTimestamp, SIGNED_MAX_AGE_MS, SIGNED_MAX_SKEW_MS } = await loadClientModule('key-exchange-message.mjs');
      const expectedMessage = keyExchangeMessage({ address: request.signerAddress, challenge: request.challenge });

      if (request.message !== expectedMessage) {
        console.error('Key exchange message mismatch');
        console.error('Expected:', expectedMessage);
        console.error('Received:', request.message);
        return null;
      }

      const recoveredAddress = ethers.utils.verifyMessage(request.message, request.signature);
      if (recoveredAddress.toLowerCase() !== request.signerAddress.toLowerCase()) {
        console.error('Signer verification failed');
        return null;
      }

      // The challenge is the device's, and it must name THIS host, be fresh, and
      // be seen once — else a captured handshake opens a session as that device
      // on any host, forever. Same window as bot auth; the nonce is claimed only
      // after the signature proved who minted it, so a flood cannot burn the store.
      if (guard) {
        const c = parseConnectChallenge(request.challenge);
        if (!c) { console.warn('[epistery] /connect refused: challenge does not name its host and moment (upgrade the client)'); return null; }
        if (c.aud !== guard.audience) { console.warn(`[epistery] /connect refused: challenge is for ${c.aud}, not ${guard.audience}`); return null; }
        const now = guard.now ?? Date.now();
        if (!isFreshTimestamp(c.ts, now)) { console.warn('[epistery] /connect refused: stale or future-dated challenge'); return null; }
        if (!(await guard.claimNonce(`connect:${c.nonce}`, now + SIGNED_MAX_AGE_MS + SIGNED_MAX_SKEW_MS))) { console.warn('[epistery] /connect refused: challenge replayed'); return null; }
      }

      // The host's proof back: its own challenge, signed by the connected signer.
      const serverChallenge = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const serverSignature = await signer.signMessage(serverResponseMessage({ address: signer.address, challenge: serverChallenge }));

      const response: KeyExchangeResponse = {
        serverAddress: signer.address,
        serverPublicKey: signer.publicKey,
        services: ['data-write', 'data-read', 'identity-verification', 'blockchain-interaction'],
        challenge: serverChallenge,
        signature: serverSignature,
        identified: true,
        authenticated: false,
        profile: undefined
      };
      return response;
    } catch (error) {
      console.error('Key exchange error:', error);
      return null;
    }
  }
}
