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
    this.rivetKey = null;  // Non-extractable browser key
    this.rivetCertificate = null;  // Signed by Web3 wallet
  }

  toJSON() {
    // Only persist the essential data, not the complex objects
    return {
      ...super.toJSON(),
      hasRivet: !!localStorage.getItem('epistery_rivet')
      // Don't serialize signer/provider/rivetKey - they'll be recreated
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

  // ===== RIVET KEY DELEGATION =====
  // Generate and certify a non-extractable browser key for popup-free signing

  /**
   * Delegate signing authority to a non-extractable browser "rivet" key
   * Requires ONE MetaMask popup to sign the delegation certificate
   * After this, signWithRivet() can be used without popups
   *
   * @param {string} domain - Domain this rivet key is authorized for
   * @param {number} expiresAt - Unix timestamp when delegation expires
   * @returns {Object} Certificate data including signature
   */
  async delegateToRivetKey(domain, expiresAt) {
    if (!this.signer) {
      throw new Error('Web3 wallet not connected');
    }

    // 1. Generate non-extractable keypair in browser
    const rivetKeyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256"  // Standard NIST curve, well-supported
      },
      false,  // NON-EXTRACTABLE - site JavaScript cannot read private key
      ["sign", "verify"]
    );

    // 2. Export only the public key (private key stays in browser crypto store)
    const publicKeyBuffer = await crypto.subtle.exportKey(
      "spki",
      rivetKeyPair.publicKey
    );
    const publicKeyHex = this._bufferToHex(publicKeyBuffer);

    // 3. Create certificate to be signed by Web3 wallet
    const certificate = {
      rivetPublicKey: publicKeyHex,
      walletAddress: this.address,
      domain: domain,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: expiresAt,
      permissions: ['sign', 'authenticate'],
      version: 1
    };

    const certificateMessage = JSON.stringify(certificate, null, 0);

    // 4. MetaMask signs the certificate (ONE popup - user authorizes delegation)
    console.log('Requesting MetaMask signature to authorize rivet key...');
    const signature = await this.signer.signMessage(certificateMessage);

    // 5. Store everything securely
    const rivetKeyId = crypto.randomUUID();

    // Store private key in IndexedDB (still non-extractable)
    await this._storeRivetKeyInIndexedDB(rivetKeyId, rivetKeyPair.privateKey);

    // Store certificate and metadata in localStorage
    const rivetData = {
      keyId: rivetKeyId,
      certificate: certificate,
      signature: signature,
      publicKey: publicKeyHex
    };

    localStorage.setItem('epistery_rivet', JSON.stringify(rivetData));

    this.rivetKey = rivetKeyPair.privateKey;
    this.rivetCertificate = rivetData;

    console.log('Rivet key delegation successful - popup-free signing enabled');
    return rivetData;
  }

  /**
   * Check if a valid rivet key exists and is not expired
   * @returns {boolean} True if rivet key is available
   */
  hasValidRivetKey() {
    try {
      const rivetData = JSON.parse(localStorage.getItem('epistery_rivet'));
      if (!rivetData) return false;

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      return rivetData.certificate.expiresAt > now;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sign a message with the rivet key (no MetaMask popup!)
   * Returns signature plus full certificate chain for server verification
   *
   * @param {string} message - Message to sign
   * @returns {Object} Signature, certificate, and proof chain
   */
  async signWithRivet(message) {
    // Attempt to restore rivet key if not loaded
    if (!this.rivetKey) {
      const rivetData = JSON.parse(localStorage.getItem('epistery_rivet'));
      if (!rivetData) {
        throw new Error('No rivet key found. Call delegateToRivetKey() first.');
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (rivetData.certificate.expiresAt < now) {
        throw new Error('Rivet key expired. Re-delegate required.');
      }

      // Restore non-extractable key from IndexedDB
      this.rivetKey = await this._getRivetKeyFromIndexedDB(rivetData.keyId);
      this.rivetCertificate = rivetData;
    }

    // Sign with non-extractable key (NO MetaMask popup!)
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    const signatureBuffer = await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      this.rivetKey,
      data
    );

    const signatureHex = this._bufferToHex(signatureBuffer);

    // Return signature AND certificate for server verification
    return {
      message: message,
      rivetSignature: signatureHex,
      certificate: this.rivetCertificate.certificate,
      certificateSignature: this.rivetCertificate.signature,
      walletAddress: this.address
    };
  }

  /**
   * Revoke the rivet key delegation
   */
  revokeRivetKey() {
    localStorage.removeItem('epistery_rivet');
    this.rivetKey = null;
    this.rivetCertificate = null;

    // Note: IndexedDB key will remain but without the localStorage reference
    // it's effectively orphaned. Could add explicit IndexedDB cleanup if needed.
    console.log('Rivet key revoked');
  }

  // ===== INDEXEDDB UTILITIES FOR NON-EXTRACTABLE KEYS =====

  /**
   * Store a non-extractable CryptoKey in IndexedDB
   * @private
   */
  async _storeRivetKeyInIndexedDB(keyId, privateKey) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpisteryRivetKeys', 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys');
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['keys'], 'readwrite');
        const store = transaction.objectStore('keys');
        store.put(privateKey, keyId);

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieve a non-extractable CryptoKey from IndexedDB
   * @private
   */
  async _getRivetKeyFromIndexedDB(keyId) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpisteryRivetKeys', 1);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['keys'], 'readonly');
        const store = transaction.objectStore('keys');
        const getRequest = store.get(keyId);

        getRequest.onsuccess = () => {
          db.close();
          if (getRequest.result) {
            resolve(getRequest.result);
          } else {
            reject(new Error('Rivet key not found in IndexedDB'));
          }
        };
        getRequest.onerror = () => {
          db.close();
          reject(getRequest.error);
        };
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Convert ArrayBuffer to hex string
   * @private
   */
  _bufferToHex(buffer) {
    return '0x' + Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
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