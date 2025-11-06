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
    } else if (data.source === 'rivet') {
      return await RivetWallet.fromJSON(data, ethers);
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

// Rivet Wallet (Non-extractable browser wallet)
export class RivetWallet extends Wallet {
  constructor() {
    super();
    this.source = 'rivet';
    this.keyId = null;
    this.type = 'Browser'; // Browser, Contract, or Web3
    this.label = null;
    this.provider = null;
    this.createdAt = null;
    this.lastUpdated = null;
    this.encryptedPrivateKey = null;
    this.contractAddress = null; // If upgraded to IdentityContract
    this.rivetAddress = null; // Original rivet address (if using contract)
    this.associations = []; // Associated keys (e.g., Web3 wallet as second factor)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      keyId: this.keyId,
      type: this.type,
      label: this.label,
      provider: this.provider,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
      encryptedPrivateKey: this.encryptedPrivateKey,
      contractAddress: this.contractAddress,
      rivetAddress: this.rivetAddress,
      associations: this.associations
    };
  }

  static async fromJSON(data, ethers) {
    const wallet = new RivetWallet();
    wallet.address = data.address;
    wallet.publicKey = data.publicKey;
    wallet.keyId = data.keyId;
    wallet.type = data.type || 'Browser';
    wallet.label = data.label;
    wallet.provider = data.provider;
    wallet.createdAt = data.createdAt;
    wallet.lastUpdated = data.lastUpdated;
    wallet.encryptedPrivateKey = data.encryptedPrivateKey;
    wallet.contractAddress = data.contractAddress;
    wallet.rivetAddress = data.rivetAddress;
    wallet.associations = data.associations || [];

    return wallet;
  }

  static async create(ethers) {
    const wallet = new RivetWallet();

    try {
      // Generate unique keyId
      wallet.keyId = 'rivet-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      wallet.createdAt = Date.now();
      wallet.lastUpdated = Date.now();
      wallet.label = 'Browser Wallet';

      // Check if Web Crypto API is available
      if (!window.crypto || !window.crypto.subtle) {
        console.warn('Web Crypto API not available, falling back to extractable keys');
        // Fallback to regular ethers wallet
        const ethersWallet = ethers.Wallet.createRandom();
        wallet.address = ethersWallet.address;
        wallet.publicKey = ethersWallet.publicKey;
        wallet.encryptedPrivateKey = ethersWallet.privateKey; // Not actually encrypted in fallback
        return wallet;
      }

      // Generate non-extractable AES-GCM key for encrypting the secp256k1 private key
      const masterKey = await crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256
        },
        false, // non-extractable!
        ['encrypt', 'decrypt']
      );

      // Store master key in IndexedDB (non-extractable CryptoKey)
      await RivetWallet.storeMasterKey(wallet.keyId, masterKey);

      // Generate secp256k1 wallet for Ethereum compatibility
      const ethersWallet = ethers.Wallet.createRandom();
      wallet.address = ethersWallet.address;
      wallet.publicKey = ethersWallet.publicKey;

      // Encrypt the private key with the master key
      const privateKeyBytes = ethers.utils.arrayify(ethersWallet.privateKey);
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        masterKey,
        privateKeyBytes
      );

      // Store encrypted private key and IV
      wallet.encryptedPrivateKey = JSON.stringify({
        encrypted: ethers.utils.hexlify(new Uint8Array(encryptedBuffer)),
        iv: ethers.utils.hexlify(iv)
      });

      return wallet;
    } catch (error) {
      console.error('Failed to create rivet wallet:', error);
      throw error;
    }
  }

  async sign(message, ethers) {
    try {
      // Retrieve master key from IndexedDB
      const masterKey = await RivetWallet.getMasterKey(this.keyId);
      if (!masterKey) {
        throw new Error('Master key not found - rivet may have been created in a different browser context');
      }

      // Decrypt the private key
      const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
      const encryptedBytes = ethers.utils.arrayify(encrypted);
      const ivBytes = ethers.utils.arrayify(iv);

      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBytes
        },
        masterKey,
        encryptedBytes
      );

      const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));

      // Create temporary signer and sign
      const signer = new ethers.Wallet(privateKey);
      const signature = await signer.signMessage(message);

      return signature;
    } catch (error) {
      console.error('Failed to sign message with rivet:', error);
      throw error;
    }
  }

  // IndexedDB operations for storing non-extractable CryptoKey
  static async storeMasterKey(keyId, masterKey) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpisteryRivets', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['masterKeys'], 'readwrite');
        const store = transaction.objectStore('masterKeys');

        const putRequest = store.put({ keyId, masterKey });

        putRequest.onsuccess = () => {
          db.close();
          resolve();
        };

        putRequest.onerror = () => {
          db.close();
          reject(putRequest.error);
        };
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('masterKeys')) {
          db.createObjectStore('masterKeys', { keyPath: 'keyId' });
        }
      };
    });
  }

  static async getMasterKey(keyId) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpisteryRivets', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['masterKeys'], 'readonly');
        const store = transaction.objectStore('masterKeys');

        const getRequest = store.get(keyId);

        getRequest.onsuccess = () => {
          db.close();
          resolve(getRequest.result ? getRequest.result.masterKey : null);
        };

        getRequest.onerror = () => {
          db.close();
          reject(getRequest.error);
        };
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('masterKeys')) {
          db.createObjectStore('masterKeys', { keyPath: 'keyId' });
        }
      };
    });
  }

  // Identity Contract methods (opt-in, not automatic)

  /**
   * Deploys a new IdentityContract with this rivet as the first authorized signer
   * @param {ethers} ethers - ethers.js instance
   * @param {object} providerConfig - Provider configuration with rpc and chainId
   * @returns {Promise<string>} Contract address
   */
  async deployIdentityContract(ethers, providerConfig) {
    try {
      // Get the private key to create a signer
      const masterKey = await RivetWallet.getMasterKey(this.keyId);
      if (!masterKey) {
        throw new Error('Master key not found');
      }

      const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
      const encryptedBytes = ethers.utils.arrayify(encrypted);
      const ivBytes = ethers.utils.arrayify(iv);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        masterKey,
        encryptedBytes
      );

      const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));
      const provider = new ethers.providers.JsonRpcProvider(providerConfig.rpc);
      const signer = new ethers.Wallet(privateKey, provider);

      // Load contract artifact
      const response = await fetch('/.well-known/epistery/artifacts/IdentityContract.json');
      const artifact = await response.json();

      // Get current gas price from network
      const feeData = await provider.getFeeData();

      // Polygon Amoy requires minimum 25 Gwei priority fee
      const minPriorityFee = ethers.utils.parseUnits('25', 'gwei');
      const safePriorityFee = ethers.utils.parseUnits('30', 'gwei');
      const safeMaxFee = ethers.utils.parseUnits('50', 'gwei');

      // Use network gas prices but ensure they meet the minimum
      let maxPriorityFeePerGas = safePriorityFee;
      if (feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gte(minPriorityFee)) {
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      }

      let maxFeePerGas = safeMaxFee;
      if (feeData.maxFeePerGas && feeData.maxFeePerGas.gte(minPriorityFee)) {
        maxFeePerGas = feeData.maxFeePerGas;
      }

      console.log('Raw feeData from network:', feeData);
      console.log('Calculated gas settings:', {
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        maxPriorityFeePerGasGwei: ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei') + ' Gwei',
        maxFeePerGas: maxFeePerGas.toString(),
        maxFeePerGasGwei: ethers.utils.formatUnits(maxFeePerGas, 'gwei') + ' Gwei'
      });

      // Deploy contract with proper gas settings
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

      // For factory.deploy(), overrides must be the LAST parameter
      // Since contract has no constructor args, we still need to pass overrides separately
      const deployTx = factory.getDeployTransaction();

      // Manual gas limit since estimation may fail with low balance
      const gasLimit = ethers.BigNumber.from(750000); // Sufficient for IdentityContract deployment

      const tx = await signer.sendTransaction({
        ...deployTx,
        type: 2,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        maxFeePerGas: maxFeePerGas,
        gasLimit: gasLimit
      });

      console.log('Deploy transaction sent:', tx.hash);
      const receipt = await tx.wait();
      console.log('Contract deployed at:', receipt.contractAddress);

      // Create contract instance
      const contract = new ethers.Contract(receipt.contractAddress, artifact.abi, signer);
      await contract.deployed();

      // Upgrade this rivet to use the contract
      this.upgradeToContract(contract.address);

      console.log('IdentityContract deployed at:', contract.address);
      return contract.address;
    } catch (error) {
      console.error('Failed to deploy IdentityContract:', error);
      throw error;
    }
  }

  /**
   * Generates a join token - this creates an INVITATION for another rivet to request joining
   * The new rivet will provide its address, and this rivet (already in the contract) will add it
   * @param {string} contractAddress - The identity contract address
   * @param {ethers} ethers - ethers.js instance
   * @returns {Promise<string>} Join token (base64-encoded JSON)
   */
  async generateJoinToken(contractAddress, ethers) {
    const payload = {
      contractAddress,
      inviterRivetAddress: this.rivetAddress || this.address,
      timestamp: Date.now(),
      expiresAt: Date.now() + 3600000 // 1 hour
    };

    // Sign the payload to prove this is a legitimate invitation
    const message = JSON.stringify(payload);
    const signature = await this.sign(message, ethers);

    const token = {
      payload,
      signature
    };

    // Return base64-encoded token
    return btoa(JSON.stringify(token));
  }

  /**
   * Accepts a join token - verifies the invitation and upgrades this rivet to use that contract
   * Returns this rivet's address so the inviter can add it to the contract
   * @param {string} joinToken - The join token from another rivet (base64-encoded)
   * @param {ethers} ethers - ethers.js instance
   * @returns {Promise<{contractAddress: string, myRivetAddress: string}>}
   */
  async acceptJoinToken(joinToken, ethers) {
    try {
      // Decode token
      const tokenData = JSON.parse(atob(joinToken));
      const { payload, signature } = tokenData;

      // Verify token hasn't expired
      if (Date.now() > payload.expiresAt) {
        throw new Error('Join token has expired');
      }

      // The contract we're joining (from the token)
      const targetContract = payload.contractAddress;

      // Verify the signature from the inviter
      const message = JSON.stringify(payload);
      const recoveredAddress = ethers.utils.verifyMessage(message, signature);
      if (recoveredAddress.toLowerCase() !== payload.inviterRivetAddress.toLowerCase()) {
        throw new Error('Invalid join token signature');
      }

      // Upgrade this rivet to use the contract as its identity
      this.upgradeToContract(targetContract);

      const myRivetAddress = this.rivetAddress || this.address;
      console.log('Rivet ready to join identity contract:', myRivetAddress);

      return {
        contractAddress: targetContract,
        myRivetAddress: myRivetAddress
      };
    } catch (error) {
      console.error('Failed to accept join token:', error);
      throw error;
    }
  }

  /**
   * Adds another rivet to this identity contract (must be called by an authorized rivet)
   * @param {string} rivetAddressToAdd - The rivet address to add
   * @param {ethers} ethers - ethers.js instance
   * @param {object} providerConfig - Provider configuration with rpc
   * @returns {Promise<void>}
   */
  async addRivetToContract(rivetAddressToAdd, ethers, providerConfig) {
    try {
      if (!this.contractAddress) {
        throw new Error('This rivet is not part of an identity contract');
      }

      // Get this rivet's private key to interact with the contract
      const masterKey = await RivetWallet.getMasterKey(this.keyId);
      if (!masterKey) {
        throw new Error('Master key not found');
      }

      const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
      const encryptedBytes = ethers.utils.arrayify(encrypted);
      const ivBytes = ethers.utils.arrayify(iv);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        masterKey,
        encryptedBytes
      );

      const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));
      const provider = new ethers.providers.JsonRpcProvider(providerConfig.rpc);
      const signer = new ethers.Wallet(privateKey, provider);

      // Load contract artifact
      const response = await fetch('/.well-known/epistery/artifacts/IdentityContract.json');
      const artifact = await response.json();

      // Get current gas price from network
      const feeData = await provider.getFeeData();

      // Polygon Amoy requires minimum 25 Gwei priority fee
      const minPriorityFee = ethers.utils.parseUnits('25', 'gwei');
      const safePriorityFee = ethers.utils.parseUnits('30', 'gwei');
      const safeMaxFee = ethers.utils.parseUnits('50', 'gwei');

      let maxPriorityFeePerGas = safePriorityFee;
      if (feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gte(minPriorityFee)) {
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      }

      let maxFeePerGas = safeMaxFee;
      if (feeData.maxFeePerGas && feeData.maxFeePerGas.gte(minPriorityFee)) {
        maxFeePerGas = feeData.maxFeePerGas;
      }

      // Connect to the identity contract
      const contract = new ethers.Contract(this.contractAddress, artifact.abi, signer);

      // Add the rivet to the identity contract
      const tx = await contract.addRivet(rivetAddressToAdd, {
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit: ethers.BigNumber.from(100000) // Manual gas limit
      });
      await tx.wait();

      console.log('Rivet added to identity contract:', rivetAddressToAdd);
    } catch (error) {
      console.error('Failed to add rivet to contract:', error);
      throw error;
    }
  }

  /**
   * Upgrades this rivet to use an identity contract
   * Updates the wallet to present the contract address instead of rivet address
   * @param {string} contractAddress - The deployed identity contract address
   */
  upgradeToContract(contractAddress) {
    if (this.contractAddress) {
      throw new Error('Rivet is already using an identity contract');
    }

    this.rivetAddress = this.address; // Save original rivet address
    this.address = contractAddress; // Present contract address
    this.contractAddress = contractAddress;
    this.type = 'Contract';
    this.lastUpdated = Date.now();
  }
}