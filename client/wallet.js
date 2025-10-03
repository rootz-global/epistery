/*
 * Wallet - Base class for client wallets
 * 
 * Handles wallet creation, persistence, and signing for Epistery
 */

// Base Wallet class
export class Wallet {
  constructor() {
    this.address = null;
    this.publicKey = null;
    this.source = null;
  }

  // Serialize only the essential data for persistence
  toJSON() {
    return {
      address: this.address,
      publicKey: this.publicKey,
      source: this.source
    };
  }

  // Factory method to create appropriate wallet type from saved data
  static async fromJSON(data, ethers) {
    if (data.source === 'web3') {
      return await Web3Wallet.fromJSON(data, ethers);
    } else if (data.source === 'local') {
      return await BrowserWallet.fromJSON(data, ethers);
    }
    throw new Error(`Unknown wallet source: ${data.source}`);
  }

  // Abstract methods - must be implemented by subclasses
  async sign(message) {
    throw new Error('sign() must be implemented by subclass');
  }

  static async create(ethers) {
    throw new Error('create() must be implemented by subclass');
  }
}

// Web3 Wallet (MetaMask, etc.)
export class Web3Wallet extends Wallet {
  constructor() {
    super();
    this.source = 'web3';
    this.signer = null;
    this.provider = null;
  }

  toJSON() {
    // Only persist the essential data, not the complex objects
    return {
      ...super.toJSON(),
      // Don't serialize signer/provider - they'll be recreated
    };
  }

  static async fromJSON(data, ethers) {
    const wallet = new Web3Wallet();
    wallet.address = data.address;
    wallet.publicKey = data.publicKey;
    
    // Attempt to reconnect to Web3 provider
    await wallet.reconnectWeb3(ethers);
    return wallet;
  }

  static async create(ethers) {
    const wallet = new Web3Wallet();
    
    if (await wallet.connectWeb3(ethers)) {
      return wallet;
    }
    return null; // Connection failed
  }

  async connectWeb3(ethers) {
    try {
      if (typeof window !== 'undefined' && (window.ethereum || window.web3)) {
        const provider = window.ethereum || window.web3.currentProvider;
        
        // Request account access
        const accounts = await provider.request({ 
          method: 'eth_requestAccounts' 
        });
        
        if (accounts && accounts.length > 0) {
          this.address = accounts[0];
          this.provider = new ethers.providers.Web3Provider(provider);
          this.signer = this.provider.getSigner();
          
          // Get public key from first signature
          this.publicKey = await this.derivePublicKeyPlaceholder();
          
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async reconnectWeb3(ethers) {
    try {
      if (typeof window !== 'undefined' && (window.ethereum || window.web3)) {
        const provider = window.ethereum || window.web3.currentProvider;
        this.provider = new ethers.providers.Web3Provider(provider);
        this.signer = this.provider.getSigner();
        
        // Verify the address matches what we have stored
        const currentAddress = await this.signer.getAddress();
        if (currentAddress.toLowerCase() !== this.address.toLowerCase()) {
          this.address = currentAddress;
        }
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async sign(message, ethers) {
    if (!this.signer) {
      throw new Error('Web3 signer not available');
    }
    
    const signature = await this.signer.signMessage(message);
    
    // Always update public key from signature for Web3 wallets
    if (ethers) {
      this.publicKey = await this.derivePublicKeyFromSignature(message, signature, ethers);
    }
    
    return signature;
  }

  async derivePublicKeyPlaceholder() {
    // Placeholder until we get a real signature
    return `0x04${this.address.slice(2)}${'0'.repeat(64)}`;
  }

  async derivePublicKeyFromSignature(message, signature, ethers) {
    try {
      const messageHash = ethers.utils.hashMessage(message);
      return ethers.utils.recoverPublicKey(messageHash, signature);
    } catch (error) {
      console.error('Failed to derive public key from signature:', error);
      return this.derivePublicKeyPlaceholder();
    }
  }
}

// Browser Wallet (Local Storage)
export class BrowserWallet extends Wallet {
  constructor() {
    super();
    this.source = 'local';
    this.mnemonic = null;
    this.privateKey = null;
    this.signer = null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      mnemonic: this.mnemonic,
      privateKey: this.privateKey
    };
  }

  static async fromJSON(data, ethers) {
    const wallet = new BrowserWallet();
    wallet.address = data.address;
    wallet.publicKey = data.publicKey;
    wallet.mnemonic = data.mnemonic;
    wallet.privateKey = data.privateKey;
    
    // Recreate the signer
    if (wallet.mnemonic) {
      wallet.signer = ethers.Wallet.fromMnemonic(wallet.mnemonic);
    }
    
    return wallet;
  }

  static async create(ethers) {
    const wallet = new BrowserWallet();
    
    // Generate new wallet
    const ethersWallet = ethers.Wallet.createRandom();
    
    wallet.address = ethersWallet.address;
    wallet.mnemonic = ethersWallet.mnemonic?.phrase || '';
    wallet.publicKey = ethersWallet.publicKey;
    wallet.privateKey = ethersWallet.privateKey;
    wallet.signer = ethersWallet;
    
    return wallet;
  }

  async sign(message) {
    if (!this.signer) {
      throw new Error('Browser wallet signer not available');
    }
    
    return await this.signer.signMessage(message);
  }
}