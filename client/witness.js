/*
 * Witness - Browser client for Epistery
 *
 * This is the browser-side client that connects to the Epistery server
 * and provides local wallet functionality for signing data
 */

import { Wallet, Web3Wallet, BrowserWallet } from './wallet.js';

// Global ethers variable - will be loaded dynamically if needed
let ethers;

// Function to ensure ethers is loaded
async function ensureEthers() {
  if (ethers) return ethers;

  if (typeof window !== 'undefined' && window.ethers) {
    ethers = window.ethers;
    return ethers;
  }

  // Dynamically import ethers from the epistery lib endpoint
  try {
    const ethersModule = await import('/.epistery/lib/ethers.js');
    ethers = ethersModule.ethers || ethersModule.default || ethersModule;
    // Make it available globally for future use
    if (typeof window !== 'undefined') {
      window.ethers = ethers;
    }
    return ethers;
  } catch (error) {
    console.error('Failed to load ethers.js:', error);
    throw new Error('ethers.js is required but not available');
  }
}

export default class Witness {
  constructor() {
    if (Witness.instance) return Witness.instance;
    Witness.instance = this;
    this.wallet = null;
    this.server = null;
    return this;
  }

  save() {
    const data = {
      wallet: this.wallet ? this.wallet.toJSON() : null,
      server: this.server,
      serverInfo: this.serverInfo
    };
    localStorage.setItem('epistery', JSON.stringify(data));
  }

  async load() {
    const data = localStorage.getItem('epistery');
    if (data) {
      try {
        const parsed = JSON.parse(data);

        // Check if this is old format with 'client' property
        if (parsed.client && !parsed.wallet) {
          localStorage.removeItem('epistery');
          return;
        }

        // Restore wallet using factory method
        if (parsed.wallet && ethers) {
          this.wallet = await Wallet.fromJSON(parsed.wallet, ethers);
        }

        // Restore server data
        this.server = parsed.server;
        this.serverInfo = parsed.serverInfo;

      } catch (error) {
        console.error('Failed to load witness data:', error);
        // Clear corrupted data
        localStorage.removeItem('epistery');
      }
    }
  }

  static async connect() {
    let witness = new Witness();

    try {
      // Ensure ethers is loaded first
      ethers = await ensureEthers();

      // Load existing data (now that ethers is available)
      await witness.load();

      // Get server info to check chain compatibility
      await witness.fetchServerInfo();

      // Initialize wallet if needed
      if (!witness.wallet) {
        await witness.initialize();
      }

      // Verify chain compatibility and switch if needed
      await witness.ensureChainCompatibility();

      // Perform key exchange
      await witness.performKeyExchange();

    } catch (e) {
      console.error('Failed to connect to Epistery server:', e);
    }

    return witness;
  }

  async initialize() {
    try {
      // Try Web3 first, then fall back to browser wallet
      this.wallet = await Web3Wallet.create(ethers);

      if (!this.wallet) {
        this.wallet = await BrowserWallet.create(ethers);
      }

      if (this.wallet) {
        console.log(`Wallet initialized: ${this.wallet.source} (${this.wallet.address})`);
        this.save();
      } else {
        throw new Error('Failed to create any wallet type');
      }
    } catch (e) {
      console.error('Failed to initialize wallet:', e);
    }
  }

  async fetchServerInfo() {
    try {
      const response = await fetch('/.epistery');
      if (response.ok) {
        const serverInfo = await response.json();
        this.serverInfo = serverInfo.server;
      } else {
        throw new Error('Failed to fetch server info');
      }
    } catch (e) {
      console.error('Failed to fetch server info:', e);
    }
  }

  async ensureChainCompatibility() {
    if (!this.wallet || this.wallet.source !== 'web3' || !this.serverInfo) {
      return;
    }

    try {
      const targetChainId = this.serverInfo.chainId;
      const targetRpc = this.serverInfo.rpc;

      // Get current chain ID
      const currentNetwork = await this.wallet.provider.getNetwork();

      // Parse server chain ID (remove comma if present)
      const expectedChainId = parseInt(targetChainId.toString().replace(',', ''));

      if (currentNetwork.chainId !== expectedChainId) {
        await this.requestChainSwitch(expectedChainId, targetRpc, this.serverInfo.provider);
      }
    } catch (e) {
      console.warn('Chain compatibility check failed:', e);
    }
  }

  async requestChainSwitch(chainId, rpcUrl, networkName) {
    if (!window.ethereum) {
      throw new Error('No Web3 provider available for chain switching');
    }

    try {
      // First, try to switch to the chain
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });

    } catch (switchError) {
      // If the chain hasn't been added to MetaMask, add it
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${chainId.toString(16)}`,
              chainName: networkName || `Chain ${chainId}`,
              rpcUrls: [rpcUrl],
              nativeCurrency: {
                name: 'DOT',
                symbol: 'DOT',
                decimals: 18,
              },
            }],
          });

        } catch (addError) {
          console.error('Failed to add chain:', addError);
          throw addError;
        }
      } else {
        console.error('Failed to switch chain:', switchError);
        throw switchError;
      }
    }

    // Recreate the provider connection after chain switch
    if (this.wallet && this.wallet.source === 'web3') {
      this.wallet.provider = new ethers.providers.Web3Provider(window.ethereum);
      this.wallet.signer = this.wallet.provider.getSigner();
    }
  }

  generateChallenge() {
    // Generate a random 32-byte challenge for key exchange
    return ethers.utils.hexlify(ethers.utils.randomBytes(32));
  }

  async performKeyExchange() {
    try {
      if (!this.wallet) {
        throw new Error('No wallet available for key exchange');
      }

      // Create a message to sign for identity proof
      const challenge = this.generateChallenge();
      const message = `Epistery Key Exchange - ${this.wallet.address} - ${challenge}`;

      // Sign the message using the wallet
      const signature = await this.wallet.sign(message, ethers);

      // Get the updated public key (especially important for Web3 wallets)
      const publicKey = this.wallet.publicKey;

      // Send key exchange request to server
      const keyExchangeData = {
        clientAddress: this.wallet.address,
        clientPublicKey: publicKey,
        challenge: challenge,
        message: message,
        signature: signature,
        walletSource: this.wallet.source
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
        const errorResponse = await response.json();
        throw new Error(`Key exchange failed with status: ${response.status} - ${errorResponse.error || 'Unknown error'}`);
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
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    try {
      // Convert wallet to the format expected by the server
      const clientWalletInfo = {
        address: this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '', // Only available for browser wallets
        privateKey: this.wallet.privateKey || '', // Only available for browser wallets
      };

      let options = {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
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
      client: this.wallet ? {
        address: this.wallet.address,
        publicKey: this.wallet.publicKey,
        source: this.wallet.source
      } : null,
      server: this.server,
      connected: !!(this.wallet && this.server)
    };
  }
}
