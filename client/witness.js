/*
 * Witness - Browser client for Epistery
 *
 * This is the browser-side client that connects to the Epistery server
 * and provides local wallet functionality for signing data
 */

import { Wallet, Web3Wallet, BrowserWallet, RivetWallet } from './wallet.js?v=7';
import NotabotTracker from './notabot.js';

// Global ethers variable - will be loaded dynamically if needed
let ethers;

// Function to ensure ethers is loaded
async function ensureEthers() {
  if (ethers) return ethers;

  if (typeof window !== 'undefined' && window.ethers) {
    ethers = window.ethers;
    return ethers;
  }

  // Get rootPath from Witness instance if available, otherwise use default
  const rootPath = Witness.instance?.rootPath || '..';

  // Dynamically import ethers from the epistery lib endpoint
  try {
    const ethersModule = await import(`${rootPath}/lib/ethers.js`);
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
  constructor(rootPath) {
    if (Witness.instance) return Witness.instance;
    Witness.instance = this;
    this.wallet = null;
    this.server = null;
    this.notabot = null; // Will be initialized when wallet is loaded
    // Normalize rootPath - remove trailing slash, default to '..'
    this.rootPath = (rootPath || '..').replace(/\/$/, '');
    return this;
  }

  save() {
    const storageData = this.loadStorageData();

    // If current wallet exists, update or add it to the wallets array
    if (this.wallet) {
      const walletData = {
        id: this.wallet.id || this.generateWalletId(this.wallet.source),
        wallet: this.wallet.toJSON(),
        label: this.wallet.label || (this.wallet.source === 'web3' ? 'Web3 Wallet' : 'Browser Wallet'),
        createdAt: this.wallet.createdAt || Date.now(),
        lastUsed: Date.now()
      };

      // Store the ID back on the wallet object
      this.wallet.id = walletData.id;
      this.wallet.label = walletData.label;
      this.wallet.createdAt = walletData.createdAt;

      // Update or add wallet in the array
      const existingIndex = storageData.wallets.findIndex(w => w.id === walletData.id);
      if (existingIndex >= 0) {
        storageData.wallets[existingIndex] = walletData;
      } else {
        storageData.wallets.push(walletData);
      }

      // Set as default if no default exists
      if (!storageData.defaultWalletId) {
        storageData.defaultWalletId = walletData.id;
      }
    }

    storageData.server = this.server;

    localStorage.setItem('epistery', JSON.stringify(storageData));
  }

  loadStorageData() {
    const data = localStorage.getItem('epistery');
    if (!data) {
      return { wallets: [], defaultWalletId: null, server: null };
    }

    try {
      const parsed = JSON.parse(data);

      // Migrate old single-wallet format to new multi-wallet format
      if (parsed.wallet && !parsed.wallets) {
        const migratedWalletId = this.generateWalletId(parsed.wallet.source);
        return {
          wallets: [{
            id: migratedWalletId,
            wallet: parsed.wallet,
            label: parsed.wallet.source === 'web3' ? 'Web3 Wallet' : 'Browser Wallet',
            createdAt: Date.now(),
            lastUsed: Date.now()
          }],
          defaultWalletId: migratedWalletId,
          server: parsed.server
        };
      }

      return {
        wallets: parsed.wallets || [],
        defaultWalletId: parsed.defaultWalletId || null,
        server: parsed.server || null
      };
    } catch (error) {
      console.error('Failed to parse epistery data:', error);
      return { wallets: [], defaultWalletId: null, server: null };
    }
  }

  async load() {
    const storageData = this.loadStorageData();

    this.server = storageData.server;

    // Check if migration happened and persist it immediately to avoid data loss
    const currentData = localStorage.getItem('epistery');
    if (currentData) {
      const parsed = JSON.parse(currentData);
      // If we migrated from old format (had wallet but no wallets), save the migration
      if (parsed.wallet && !parsed.wallets && storageData.wallets.length > 0) {
        console.log('[epistery] Migrating old wallet format to multi-wallet format');
        localStorage.setItem('epistery', JSON.stringify(storageData));
        console.log('[epistery] Migration complete - wallet preserved');
      }
    }

    // Load the default wallet if it exists (maintains backward compatibility)
    if (storageData.defaultWalletId && ethers) {
      const walletData = storageData.wallets.find(w => w.id === storageData.defaultWalletId);
      if (walletData) {
        this.wallet = await Wallet.fromJSON(walletData.wallet, ethers);
        this.wallet.id = walletData.id;
        this.wallet.label = walletData.label;
        this.wallet.createdAt = walletData.createdAt;
      }
    }
  }

  generateWalletId(source) {
    let prefix = 'browser-wallet'; // legacy default
    if (source === 'web3') {
      prefix = 'web3-wallet';
    } else if (source === 'rivet') {
      prefix = 'rivet';
    }
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  static async connect(options = {}) {
    let witness = new Witness(options.rootPath);

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

      // Perform key exchange (skip if skipKeyExchange option is true)
      if (!options.skipKeyExchange) {
        await witness.performKeyExchange();
      }

      // Initialize notabot tracker if wallet is a rivet
      if (witness.wallet && witness.wallet.source === 'rivet') {
        witness.notabot = new NotabotTracker(witness.wallet);
        console.log('[epistery] Notabot tracker initialized');
      }

    } catch (e) {
      console.error('Failed to connect to Epistery server:', e);
      // For unclaimed domains, wallet discovery might succeed even if key exchange fails
      if (!options.skipKeyExchange) {
        throw e;
      }
    }

    return witness;
  }

  async initialize() {
    try {
      // Try RivetWallet first (non-extractable, invisible, zero friction)
      this.wallet = await RivetWallet.create(ethers);

      // Only try Web3 if user explicitly requests (not automatic)
      // BrowserWallet is legacy fallback only

      if (this.wallet) {
        console.log(`Wallet initialized: ${this.wallet.source} (${this.wallet.address})`);
        this.save();
      } else {
        throw new Error('Failed to create rivet wallet');
      }
    } catch (e) {
      console.error('Failed to initialize wallet:', e);
    }
  }

  async fetchServerInfo() {
    try {
      const response = await fetch(this.rootPath, {
        headers: { 'Accept': 'application/json' }
      });
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
          // Build nativeCurrency from serverInfo with sensible defaults
          const nativeCurrency = this.serverInfo?.nativeCurrency || {
            name: 'ETH',
            symbol: 'ETH',
            decimals: 18
          };

          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${chainId.toString(16)}`,
              chainName: networkName || `Chain ${chainId}`,
              rpcUrls: [rpcUrl],
              nativeCurrency: nativeCurrency,
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

      // For rivets with identity contracts, use the rivet address for signing
      // but present the contract address as the identity
      const signingAddress = this.wallet.rivetAddress || this.wallet.address;
      const identityAddress = this.wallet.address;

      // Create a message to sign for identity proof
      const challenge = this.generateChallenge();
      const message = `Epistery Key Exchange - ${signingAddress} - ${challenge}`;

      // Sign the message using the wallet
      const signature = await this.wallet.sign(message, ethers);

      // Get the updated public key (especially important for Web3 wallets)
      const publicKey = this.wallet.publicKey;

      // Send key exchange request to server
      const keyExchangeData = {
        clientAddress: signingAddress, // Use signing address for verification
        clientPublicKey: publicKey,
        challenge: challenge,
        message: message,
        signature: signature,
        walletSource: this.wallet.source,
        // Include identity info if using a contract
        identityAddress: identityAddress !== signingAddress ? identityAddress : undefined,
        contractAddress: this.wallet.contractAddress
      };

      const response = await fetch(`${this.rootPath}/connect`, {
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
            identified: true,
            provider: this.serverInfo?.provider,
            chainId: this.serverInfo?.chainId,
            rpc: this.serverInfo?.rpc,
            nativeCurrency: this.serverInfo?.nativeCurrency
          };

          this.save();
          console.log('Key exchange completed successfully');
          console.log('Server address:', this.server.address);
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

  /**
   * Transfers ownership of data wallet to another address
   *
   * Supports both client-side (rivet) and server-side (browser/web3) signing.
   *
   * @param {string} futureOwnerWalletAddress - Address of new owner
   * @returns {Promise<any>} Transaction receipt
   */
  async transferOwnershipEvent(futureOwnerWalletAddress) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    if (this.wallet.source === 'rivet') {

      try {
        // STEP 1: Prepare
        const prepareResponse = await fetch(`${this.rootPath}/data/prepare-transfer-ownership`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientAddress: this.wallet.rivetAddress || this.wallet.address,
            futureOwnerAddress: futureOwnerWalletAddress
          })
        });

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare: ${error.error}`);
        }

        const { unsignedTransaction, metadata } = await prepareResponse.json();

        // STEP 2: Sign
        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(unsignedTransaction, ethers);
        console.log('Transaction signed');

        // STEP 3: Submit
        const submitResponse = await fetch(`${this.rootPath}/data/submit-signed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: signedTx,
            operation: 'transferOwnership',
            metadata: metadata
          })
        });

        if (!submitResponse.ok) {
          const error = await submitResponse.json();
          throw new Error(`Failed to submit: ${error.error}`);
        }

        return await submitResponse.json();

      } catch (error) {
        console.error('Client-side signing for transferOwnership failed:', error);
        throw error;
      }

    } else {
      // ===== OLD FLOW: Server-Side Signing =====
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
        walletType: this.wallet.source
      };

      const result = await fetch(`${this.rootPath}/data/ownership`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientWalletInfo, futureOwnerWalletAddress })
      });

      if (!result.ok) {
        const error = await result.json();
        throw new Error(`Transfer ownership failed: ${error.error}`);
      }

      return await result.json();
    }
  }

  /**
   * Creates an approval request
   *
   * @param {string} approverAddress - Address that will approve/deny
   * @param {string} fileName - Name of file
   * @param {string} fileHash - Hash of file
   * @param {string} domain - Domain context
   * @returns {Promise<any>} Transaction receipt
   */
  async createApprovalEvent(approverAddress, fileName, fileHash, domain) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    if (this.wallet.source === 'rivet') {
      try {
        // STEP 1: Prepare
        const prepareResponse = await fetch(`${this.rootPath}/approval/prepare-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientAddress: this.wallet.rivetAddress || this.wallet.address,
            approverAddress,
            fileName,
            fileHash,
            domain
          })
        });

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare: ${error.error}`);
        }

        const { unsignedTransaction, metadata } = await prepareResponse.json();

        // STEP 2: Sign
        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(unsignedTransaction, ethers);

        // STEP 3: Submit
        const submitResponse = await fetch(`${this.rootPath}/data/submit-signed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: signedTx,
            operation: 'createApproval',
            metadata: metadata
          })
        });

        if (!submitResponse.ok) {
          const error = await submitResponse.json();
          throw new Error(`Failed to submit: ${error.error}`);
        }

        return await submitResponse.json();

      } catch (error) {
        console.error('Client-side signing for createApproval failed:', error);
        throw error;
      }

    } else {
      // ===== OLD FLOW =====
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
        walletType: this.wallet.source
      };

      const result = await fetch(`${this.rootPath}/approval/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientWalletInfo, approverAddress, fileName, fileHash, domain })
      });

      if (!result.ok) {
        const error = await result.json();
        throw new Error(`Create approval failed: ${error.error}`);
      }

      return await result.json();
    }
  }

  async getApprovalsEvent(approverAddress, requestorAddress) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
      };

      let options = {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
        approverAddress: approverAddress,
        requestorAddress: requestorAddress
      });

      let result = await fetch(`${this.rootPath}/approval/get`, options);

      if (result.ok) {
        return await result.json();
      }
      else {
        throw new Error(`Get approvals failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error('Failed to execute get approvals event:', e);
      throw e;
    }
  }

  async getAllApprovalsForApproverEvent(approverAddress) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
      };

      let options = {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
        approverAddress: approverAddress
      });

      let result = await fetch(`${this.rootPath}/approval/get-all`, options);

      if (result.ok) {
        return await result.json();
      }
      else {
        throw new Error(`Get all approvals failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error('Failed to execute get all approvals event:', e);
      throw e;
    }
  }

  async getAllApprovalsForRequestorEvent(requestorAddress) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
      };

      let options = {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
        requestorAddress: requestorAddress
      });

      let result = await fetch(`${this.rootPath}/approval/get-all-requestor`, options);

      if (result.ok) {
        return await result.json();
      }
      else {
        throw new Error(`Get all approvals for requestor failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error('Failed to execute get all approvals for requestor event:', e);
      throw e;
    }
  }

  /**
   * Handles an approval request (approve or deny)
   *
   * @param {string} requestorAddress - Address that made the request
   * @param {string} fileName - Name of file
   * @param {boolean} approved - True to approve, false to deny
   * @returns {Promise<any>} Transaction receipt
   */
  async handleApprovalEvent(requestorAddress, fileName, approved) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    if (this.wallet.source === 'rivet') {
      try {
        // STEP 1: Prepare
        const prepareResponse = await fetch(`${this.rootPath}/approval/prepare-handle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approverAddress: this.wallet.rivetAddress || this.wallet.address,
            requestorAddress,
            fileName,
            approved,
            domain: window.location.hostname
          })
        });

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare: ${error.error}`);
        }

        const { unsignedTransaction, metadata } = await prepareResponse.json();

        // STEP 2: Sign
        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(unsignedTransaction, ethers);

        // STEP 3: Submit
        const submitResponse = await fetch(`${this.rootPath}/data/submit-signed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: signedTx,
            operation: 'handleApproval',
            metadata: metadata
          })
        });

        if (!submitResponse.ok) {
          const error = await submitResponse.json();
          throw new Error(`Failed to submit: ${error.error}`);
        }

        return await submitResponse.json();

      } catch (error) {
        console.error('Client-side signing for handleApproval failed:', error);
        throw error;
      }

    } else {
      // ===== OLD FLOW =====
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
        walletType: this.wallet.source
      };

      const result = await fetch(`${this.rootPath}/approval/handle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientWalletInfo, requestorAddress, fileName, approved })
      });

      if (!result.ok) {
        const error = await result.json();
        throw new Error(`Handle approval failed: ${error.error}`);
      }

      return await result.json();
    }
  }

  async readEvent() {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
      };

      let options = {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
      });

      let result = await fetch(`${this.rootPath}/data/read`, options);
      if (result.status === 204) {
        return null;
      }

      if (result.ok) {
        return await result.json();
      }
      else {
        throw new Error(`Read failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error('Failed to execute read event:', e);
      throw e;
    }
  }

  /**
   * Writes an event to the data wallet
   *
   * This method now supports TWO flows:
   * 1. NEW FLOW (RivetWallet): Client-side signing
   *    - prepare transaction → sign locally → submit signed tx
   * 2. OLD FLOW (BrowserWallet, Web3Wallet): Server-side signing
   *    - send mnemonic → server signs and broadcasts
   *
   * @param {any} data - Data to write
   * @returns {Promise<any>} Transaction receipt
   */
  async writeEvent(data) {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    if (this.wallet.source === 'rivet') {
      try {
        const prepareResponse = await fetch(`${this.rootPath}/data/prepare-write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientAddress: this.wallet.rivetAddress || this.wallet.address,
            publicKey: this.wallet.publicKey,
            data: data
          })
        });

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare transaction: ${error.error}`);
        }

        const { unsignedTransaction, ipfsHash, metadata } = await prepareResponse.json();

        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(unsignedTransaction, ethers);
        const submitResponse = await fetch(`${this.rootPath}/data/submit-signed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: signedTx,
            operation: 'write',
            metadata: { ipfsHash, ...metadata }
          })
        });

        if (!submitResponse.ok) {
          const error = await submitResponse.json();
          throw new Error(`Failed to submit transaction: ${error.error}`);
        }

        const receipt = await submitResponse.json();

        return {
          success: true,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          status: receipt.status,
          ipfsHash: ipfsHash,
          ipfsUrl: metadata.ipfsUrl
        };

      } catch (error) {
        console.error('Client-side signing flow failed:', error);
        throw error;
      }

    } else {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || '',
        privateKey: this.wallet.privateKey || '',
        walletType: this.wallet.source  // 'browser' or 'web3'
      };

      const result = await fetch(`${this.rootPath}/data/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientWalletInfo, data })
      });

      if (!result.ok) {
        const error = await result.json();
        throw new Error(`Write failed: ${error.error}`);
      }

      return await result.json();
    }
  }

  // Wallet management methods for multi-wallet support

  getWallets() {
    const storageData = this.loadStorageData();
    return {
      wallets: storageData.wallets.map(w => ({
        id: w.id,
        address: w.wallet.address,
        source: w.wallet.source,
        label: w.label,
        createdAt: w.createdAt,
        lastUsed: w.lastUsed,
        isDefault: w.id === storageData.defaultWalletId
      })),
      defaultWalletId: storageData.defaultWalletId
    };
  }

  async addWeb3Wallet(label = null) {
    await ensureEthers();
    const newWallet = await Web3Wallet.create(ethers);

    if (!newWallet) {
      throw new Error('Failed to connect Web3 wallet. User may have cancelled or no Web3 provider available.');
    }

    newWallet.label = label || 'Web3 Wallet';

    // Temporarily set as active wallet to save it
    const previousWallet = this.wallet;
    this.wallet = newWallet;
    this.save();

    // Restore previous wallet if there was one
    if (previousWallet) {
      this.wallet = previousWallet;
    }

    return {
      id: newWallet.id,
      address: newWallet.address,
      source: newWallet.source,
      label: newWallet.label
    };
  }

  async addBrowserWallet(label = null) {
    await ensureEthers();
    const newWallet = await BrowserWallet.create(ethers);

    if (!newWallet) {
      throw new Error('Failed to create browser wallet');
    }

    newWallet.label = label || 'Browser Wallet';

    // Temporarily set as active wallet to save it
    const previousWallet = this.wallet;
    this.wallet = newWallet;
    this.save();

    // Restore previous wallet if there was one
    if (previousWallet) {
      this.wallet = previousWallet;
    }

    return {
      id: newWallet.id,
      address: newWallet.address,
      source: newWallet.source,
      label: newWallet.label
    };
  }

  async setDefaultWallet(walletId) {
    const storageData = this.loadStorageData();
    const walletData = storageData.wallets.find(w => w.id === walletId);

    if (!walletData) {
      throw new Error(`Wallet with ID ${walletId} not found`);
    }

    await ensureEthers();

    // Load the wallet
    this.wallet = await Wallet.fromJSON(walletData.wallet, ethers);
    this.wallet.id = walletData.id;
    this.wallet.label = walletData.label;
    this.wallet.createdAt = walletData.createdAt;

    // Update default in storage
    storageData.defaultWalletId = walletId;
    storageData.wallets = storageData.wallets.map(w => {
      if (w.id === walletId) {
        w.lastUsed = Date.now();
      }
      return w;
    });

    localStorage.setItem('epistery', JSON.stringify(storageData));

    console.log(`Switched to wallet: ${this.wallet.source} (${this.wallet.address})`);

    return {
      id: this.wallet.id,
      address: this.wallet.address,
      source: this.wallet.source,
      label: this.wallet.label
    };
  }

  removeWallet(walletId) {
    const storageData = this.loadStorageData();

    // Don't allow removing the default wallet if it's the only one
    if (storageData.wallets.length === 1) {
      throw new Error('Cannot remove the only wallet');
    }

    // Don't allow removing the default wallet without switching first
    if (storageData.defaultWalletId === walletId) {
      throw new Error('Cannot remove default wallet. Switch to another wallet first.');
    }

    const walletIndex = storageData.wallets.findIndex(w => w.id === walletId);
    if (walletIndex === -1) {
      throw new Error(`Wallet with ID ${walletId} not found`);
    }

    storageData.wallets.splice(walletIndex, 1);
    localStorage.setItem('epistery', JSON.stringify(storageData));

    return true;
  }

  updateWalletLabel(walletId, newLabel) {
    const storageData = this.loadStorageData();
    const walletData = storageData.wallets.find(w => w.id === walletId);

    if (!walletData) {
      throw new Error(`Wallet with ID ${walletId} not found`);
    }

    walletData.label = newLabel;

    // If this is the current wallet, update it too
    if (this.wallet && this.wallet.id === walletId) {
      this.wallet.label = newLabel;
    }

    localStorage.setItem('epistery', JSON.stringify(storageData));

    return true;
  }

  getStatus() {
    return {
      client: this.wallet ? {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        source: this.wallet.source
      } : null,
      server: this.server,
      connected: !!(this.wallet && this.server)
    };
  }
}
