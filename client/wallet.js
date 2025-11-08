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

      // Manual gas limit since estimation may fail with low balance
      const gasLimit = ethers.BigNumber.from(750000); // Sufficient for IdentityContract deployment

      // Check if wallet has sufficient balance before attempting deployment
      const balance = await signer.getBalance();
      const estimatedCost = gasLimit.mul(maxFeePerGas);

      if (balance.lt(estimatedCost)) {
        const networkName = providerConfig.networkName || `Chain ID ${providerConfig.chainId}`;
        const currency = providerConfig.nativeCurrency?.symbol || 'native currency';
        throw new Error(
          `Insufficient ${currency} to deploy Identity Contract.\n\n` +
          `Network: ${networkName}\n` +
          `Your balance: ${ethers.utils.formatEther(balance)} ${currency}\n` +
          `Estimated cost: ${ethers.utils.formatEther(estimatedCost)} ${currency}\n` +
          `Needed: ${ethers.utils.formatEther(estimatedCost.sub(balance))} ${currency} more\n\n` +
          `Get testnet ${currency} from a faucet or switch to a different network.`
        );
      }

      // Deploy contract with proper gas settings
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

      // For factory.deploy(), overrides must be the LAST parameter
      // Since contract has no constructor args, we still need to pass overrides separately
      const deployTx = factory.getDeployTransaction();

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
   * Generates a join token bound to a specific target rivet address
   * This creates a secure invitation that can only be used by the specified rivet
   * @param {string} targetRivetAddress - The rivet address that will use this token
   * @param {string} contractAddress - The identity contract address
   * @param {ethers} ethers - ethers.js instance
   * @returns {Promise<string>} Join token (base64-encoded JSON)
   */
  async generateJoinToken(targetRivetAddress, contractAddress, ethers) {
    const payload = {
      contractAddress,
      targetRivetAddress, // Token is bound to this specific address
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
   * Verifies that the token was generated specifically for this rivet's address
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

      // Get current rivet address
      const myRivetAddress = this.rivetAddress || this.address;

      // SECURITY: Verify this token was generated for THIS rivet's address
      if (payload.targetRivetAddress.toLowerCase() !== myRivetAddress.toLowerCase()) {
        throw new Error('This join token was not generated for your rivet address. Token is bound to: ' + payload.targetRivetAddress);
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
   * Static helper: Generates a rivet name based on browser, OS, and hostname
   * Format: "browser-os on hostname" (e.g., "chrome-ubuntu on rhonda.help")
   * @returns {string} Generated rivet name
   */
  static generateRivetName() {
    // Detect browser
    const userAgent = navigator.userAgent.toLowerCase();
    let browser = 'unknown';

    if (userAgent.includes('chrome') && !userAgent.includes('edg')) {
      browser = 'chrome';
    } else if (userAgent.includes('firefox')) {
      browser = 'firefox';
    } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
      browser = 'safari';
    } else if (userAgent.includes('edg')) {
      browser = 'edge';
    } else if (userAgent.includes('opr') || userAgent.includes('opera')) {
      browser = 'opera';
    }

    // Detect OS
    let os = 'unknown';
    if (userAgent.includes('win')) {
      os = 'windows';
    } else if (userAgent.includes('mac')) {
      os = 'macos';
    } else if (userAgent.includes('linux')) {
      os = 'linux';
    } else if (userAgent.includes('android')) {
      os = 'android';
    } else if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
      os = 'ios';
    }

    // Get hostname
    const hostname = window.location.hostname;

    return `${browser}-${os} on ${hostname}`;
  }

  /**
   * Static helper: Fetches a rivet address from a website URL
   * Queries the site's /.well-known/epistery endpoint to get the rivet address
   * @param {string} url - The website URL (can be with or without https://)
   * @returns {Promise<string>} The rivet address for that website
   */
  static async getRivetAddressFromURL(url) {
    try {
      // Normalize URL - ensure it has a protocol
      let normalizedURL = url.trim();
      if (!normalizedURL.startsWith('http://') && !normalizedURL.startsWith('https://')) {
        normalizedURL = `https://${normalizedURL}`;
      }

      // Remove trailing slash if present
      normalizedURL = normalizedURL.replace(/\/$/, '');

      // Fetch epistery status from the site
      const response = await fetch(`${normalizedURL}/.well-known/epistery`);

      if (!response.ok) {
        throw new Error(`Failed to fetch epistery info from ${normalizedURL}. Status: ${response.status}`);
      }

      const data = await response.json();

      // The rivet address should be in client.walletAddress
      const rivetAddress = data.client?.walletAddress;

      if (!rivetAddress) {
        throw new Error(`No rivet address found at ${normalizedURL}. The site may not have Epistery enabled or no rivet is connected.`);
      }

      return rivetAddress;
    } catch (error) {
      console.error('Failed to get rivet address from URL:', error);
      throw new Error(`Unable to get rivet address from "${url}": ${error.message}`);
    }
  }

  /**
   * Adds another rivet to this identity contract (must be called by an authorized rivet)
   * @param {string} rivetAddressToAdd - The rivet address to add
   * @param {ethers} ethers - ethers.js instance
   * @param {object} providerConfig - Provider configuration with rpc
   * @param {string} rivetName - Optional name for the rivet (auto-generated if not provided)
   * @returns {Promise<void>}
   */
  async addRivetToContract(rivetAddressToAdd, ethers, providerConfig, rivetName = '') {
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

      // Generate name if not provided (empty string is considered "not provided")
      const finalRivetName = rivetName || RivetWallet.generateRivetName();

      // Add the rivet to the identity contract with name
      const tx = await contract.addRivet(rivetAddressToAdd, finalRivetName, {
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit: ethers.BigNumber.from(100000) // Manual gas limit
      });
      await tx.wait();

      console.log('Rivet added to identity contract:', rivetAddressToAdd, 'with name:', finalRivetName);
    } catch (error) {
      console.error('Failed to add rivet to contract:', error);
      throw error;
    }
  }

  /**
   * Gets all authorized rivets from the identity contract with their names
   * @param {ethers} ethers - ethers.js instance
   * @param {object} providerConfig - Provider configuration with rpc
   * @returns {Promise<Array<{address: string, name: string}>>} Array of rivets with addresses and names
   */
  async getRivetsInContract(ethers, providerConfig) {
    try {
      if (!this.contractAddress) {
        throw new Error('This rivet is not part of an identity contract');
      }

      const provider = new ethers.providers.JsonRpcProvider(providerConfig.rpc);

      // Load contract artifact
      const response = await fetch('/.well-known/epistery/artifacts/IdentityContract.json');
      const artifact = await response.json();

      // Connect to the identity contract (read-only, no signer needed)
      const contract = new ethers.Contract(this.contractAddress, artifact.abi, provider);

      try {
        // Try to call getRivetsWithNames() (new contract version)
        const [addresses, names] = await contract.getRivetsWithNames();

        // Combine addresses and names into objects
        return addresses.map((address, index) => ({
          address: address,
          name: names[index] || 'Unnamed Rivet'
        }));
      } catch (error) {
        // Fallback to getRivets() for old contracts that don't have names
        console.warn('Contract does not support getRivetsWithNames(), falling back to getRivets()');
        const addresses = await contract.getRivets();

        // Return addresses with default names
        return addresses.map((address) => ({
          address: address,
          name: 'Unnamed Rivet (old contract)'
        }));
      }
    } catch (error) {
      console.error('Failed to get rivets from contract:', error);
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

// Expose RivetWallet globally for browser access
if (typeof window !== 'undefined') {
  window.RivetWallet = RivetWallet;
}