/*
 * Witness - Browser client for Epistery
 *
 * This is the browser-side client that connects to the Epistery server
 * and provides local wallet functionality for signing data
 */

// Global ethers variable - will be loaded dynamically if needed
let ethers;

// Function to ensure ethers is loaded
async function ensureEthers() {
  console.log('[DEBUG] ensureEthers called, current ethers:', !!ethers);

  if (ethers) return ethers;

  if (typeof window !== 'undefined' && window.ethers) {
    console.log('[DEBUG] Found ethers on window object');
    ethers = window.ethers;
    return ethers;
  }

  // Dynamically import ethers from the epistery lib endpoint
  try {
    console.log('[DEBUG] Attempting to import ethers from /.epistery/lib/ethers.js');
    const ethersModule = await import('/.epistery/lib/ethers.js');
    console.log('[DEBUG] ethersModule loaded:', ethersModule);
    ethers = ethersModule.ethers || ethersModule.default || ethersModule;
    console.log('[DEBUG] Final ethers object:', !!ethers);
    // Make it available globally for future use
    if (typeof window !== 'undefined') {
      window.ethers = ethers;
    }
    return ethers;
  } catch (error) {
    console.error('[ERROR] Failed to load ethers.js:', error);
    throw new Error('ethers.js is required but not available');
  }
}

export default class Witness {
  constructor() {
    if (Witness.instance) return Witness.instance;
    Witness.instance = this;
    return this;
  }

  save() {
    localStorage.setItem('epistery', JSON.stringify({
      client: this.client,
      server: this.server
    }));
  }

  load() {
    const data = localStorage.getItem('epistery');
    if (data) {
      const parsed = JSON.parse(data);
      Object.assign(this, parsed);
    }
  }

  static async connect() {
    let witness = new Witness();
    witness.load();

    try {
      // Ensure ethers is loaded first
      ethers = await ensureEthers();

      // Initialize client if needed
      if (!witness.client) {
        await witness.initialize();
      }

      // Perform key exchange
      await witness.performKeyExchange();

    } catch (e) {
      console.error('Failed to connect to Epistery server:', e);
    }

    return witness;
  }

  async initialize() {
    try {
      // Generate client keys locally using ethers.js (ethers loaded in connect())
      const wallet = ethers.Wallet.createRandom();

      this.client = {
        address: wallet.address,
        mnemonic: wallet.mnemonic?.phrase || '',
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey
      };

      this.save();
      console.log('Client wallet initialized locally:', this.client.address);
    } catch (e) {
      console.error('Failed to initialize client wallet:', e);
    }
  }

  generateChallenge() {
    // Generate a random 32-byte challenge for key exchange
    return ethers.utils.hexlify(ethers.utils.randomBytes(32));
  }

  async performKeyExchange() {
    try {
      // Create a message to sign for identity proof
      const challenge = this.generateChallenge();
      const message = `Epistery Key Exchange - ${this.client.address} - ${challenge}`;

      // Sign the message with client's private key
      const wallet = ethers.Wallet.fromMnemonic(this.client.mnemonic);
      const signature = await wallet.signMessage(message);

      // Send key exchange request to server
      const keyExchangeData = {
        clientAddress: this.client.address,
        clientPublicKey: this.client.publicKey,
        challenge: challenge,
        message: message,
        signature: signature
      };

      const response = await fetch('/.epistery/connect', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(keyExchangeData)
      });

      if (response.ok) {
        const serverResponse = await response.json();

        // Verify server's identity by checking signature
        if (this.verifyServerIdentity(serverResponse)) {
          this.server = {
            address: serverResponse.serverAddress,
            publicKey: serverResponse.serverPublicKey,
            services: serverResponse.services,
            challenge: serverResponse.challenge,
            signature: serverResponse.signature,
            identified: true
          };

          this.save();
          console.log('Key exchange completed successfully');
          console.log('Server address:', this.server.address);
          console.log('Available services:', this.server.services);
        } else {
          throw new Error('Server identity verification failed');
        }
      } else {
        throw new Error(`Key exchange failed with status: ${response.status}`);
      }
    } catch (e) {
      console.error('Key exchange failed:', e);
      throw e;
    }
  }

  verifyServerIdentity(serverResponse) {
    try {
      // Reconstruct the message the server should have signed
      const expectedMessage = `Epistery Server Response - ${serverResponse.serverAddress} - ${serverResponse.challenge}`;

      // Verify the signature matches the server's public key
      const recoveredAddress = ethers.utils.verifyMessage(expectedMessage, serverResponse.signature);
      return recoveredAddress === serverResponse.serverAddress;
    } catch (e) {
      console.error('Server identity verification error:', e);
      return false;
    }
  }

  async writeEvent(data) {
    if (!this.client) {
      throw new Error('Client wallet not initialized');
    }

    try {
      let options = {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: this.client,
        data: data
      });

      let result = await fetch('/.epistery/data/write', options);

      if (result.ok) {
        return await result.json();
      } else {
        throw new Error(`Write failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error('Failed to write event:', e);
      throw e;
    }
  }

  getStatus() {
    return {
      client: this.client,
      server: this.server,
      connected: !!(this.client && this.server)
    };
  }
}
