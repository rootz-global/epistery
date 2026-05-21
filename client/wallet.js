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
      source: this.source,
    };
  }

  // Factory method to create appropriate wallet type from saved data
  static async fromJSON(data, ethers) {
    if (data.source === "web3") {
      return await Web3Wallet.fromJSON(data, ethers);
    } else if (data.source === "local") {
      return await BrowserWallet.fromJSON(data, ethers);
    } else if (data.source === "rivet") {
      return await RivetWallet.fromJSON(data, ethers);
    } else if (data.source === "fido") {
      return await FidoWallet.fromJSON(data, ethers);
    }
    throw new Error(`Unknown wallet source: ${data.source}`);
  }

  // Abstract methods - must be implemented by subclasses
  async sign(message) {
    throw new Error("sign() must be implemented by subclass");
  }

  static async create(ethers) {
    throw new Error("create() must be implemented by subclass");
  }

  // Peer encryption (ECDH + AES-256-GCM) — optional capability. Wallets
  // that hold their private key in a closure (RivetWallet, FidoWallet,
  // BrowserWallet) implement these so plaintext callers never see the key.
  // Wire format: secp256k1 ECDH → SHA-256 → AES-GCM(iv:12, tag:16). The
  // shared secret + private key live only inside the implementing closure.
  async encryptForPeer(peerPublicKey, plaintextBytes, ethers) {
    throw new Error(`${this.source} wallet does not support peer encryption`);
  }

  async decryptFromPeer(peerPublicKey, ciphertextBytes, ivBytes, tagBytes, ethers) {
    throw new Error(`${this.source} wallet does not support peer decryption`);
  }
}

// Shared implementation: given a raw private key (briefly in scope) and a
// peer's uncompressed secp256k1 public key, perform ECDH and return a 256-bit
// AES-GCM CryptoKey. The shared secret never leaves this function.
// Compatible with apps/dashboard-5.0/ecdh-crypto.js: same SHA-256(sharedSecret)
// derivation, so messages can flow between wallets and external clients.
async function _deriveAesKeyFromPriv(privateKeyHex, peerPublicKeyHex, ethers) {
  const signingKey = new ethers.utils.SigningKey(privateKeyHex);
  const sharedSecretHex = signingKey.computeSharedSecret(peerPublicKeyHex);
  const secretBytes = ethers.utils.arrayify(sharedSecretHex);
  const keyMaterial = await crypto.subtle.digest("SHA-256", secretBytes);
  return await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function _aesGcmEncrypt(aesKey, plaintextBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      aesKey,
      plaintextBytes,
    ),
  );
  return {
    ciphertext: ctWithTag.slice(0, -16),
    iv,
    tag: ctWithTag.slice(-16),
  };
}

async function _aesGcmDecrypt(aesKey, ciphertextBytes, ivBytes, tagBytes) {
  const ctWithTag = new Uint8Array(ciphertextBytes.length + tagBytes.length);
  ctWithTag.set(ciphertextBytes, 0);
  ctWithTag.set(tagBytes, ciphertextBytes.length);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes, tagLength: 128 },
      aesKey,
      ctWithTag,
    ),
  );
}

// Web3 Wallet (MetaMask, etc.)
export class Web3Wallet extends Wallet {
  constructor() {
    super();
    this.source = "web3";
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
      if (typeof window !== "undefined" && (window.ethereum || window.web3)) {
        const provider = window.ethereum || window.web3.currentProvider;

        // Request account access
        const accounts = await provider.request({
          method: "eth_requestAccounts",
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
      if (typeof window !== "undefined" && (window.ethereum || window.web3)) {
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
      throw new Error("Web3 signer not available");
    }

    const signature = await this.signer.signMessage(message);

    // Always update public key from signature for Web3 wallets
    if (ethers) {
      this.publicKey = await this.derivePublicKeyFromSignature(
        message,
        signature,
        ethers,
      );
    }

    return signature;
  }

  async derivePublicKeyPlaceholder() {
    // Placeholder until we get a real signature
    return `0x04${this.address.slice(2)}${"0".repeat(64)}`;
  }

  async derivePublicKeyFromSignature(message, signature, ethers) {
    try {
      const messageHash = ethers.utils.hashMessage(message);
      return ethers.utils.recoverPublicKey(messageHash, signature);
    } catch (error) {
      console.error("Failed to derive public key from signature:", error);
      return this.derivePublicKeyPlaceholder();
    }
  }
}

// Browser Wallet (Local Storage)
export class BrowserWallet extends Wallet {
  constructor() {
    super();
    this.source = "local";
    this.mnemonic = null;
    this.privateKey = null;
    this.signer = null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      mnemonic: this.mnemonic,
      privateKey: this.privateKey,
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
    wallet.mnemonic = ethersWallet.mnemonic?.phrase || "";
    wallet.publicKey = ethersWallet.publicKey;
    wallet.privateKey = ethersWallet.privateKey;
    wallet.signer = ethersWallet;

    return wallet;
  }

  async sign(message) {
    if (!this.signer) {
      throw new Error("Browser wallet signer not available");
    }

    return await this.signer.signMessage(message);
  }

  // BrowserWallet stores privateKey openly (legacy, fallback mode) — provide
  // peer encryption for parity with Rivet/Fido so callers can use one API.
  async encryptForPeer(peerPublicKey, plaintextBytes, ethers) {
    if (!this.privateKey) throw new Error("BrowserWallet has no privateKey");
    const aesKey = await _deriveAesKeyFromPriv(this.privateKey, peerPublicKey, ethers);
    return await _aesGcmEncrypt(aesKey, plaintextBytes);
  }

  async decryptFromPeer(peerPublicKey, ciphertextBytes, ivBytes, tagBytes, ethers) {
    if (!this.privateKey) throw new Error("BrowserWallet has no privateKey");
    const aesKey = await _deriveAesKeyFromPriv(this.privateKey, peerPublicKey, ethers);
    return await _aesGcmDecrypt(aesKey, ciphertextBytes, ivBytes, tagBytes);
  }
}

// Rivet Wallet (Non-extractable browser wallet)
export class RivetWallet extends Wallet {
  constructor() {
    super();
    this.source = "rivet";
    this.keyId = null;
    this.type = "Browser"; // Browser, Contract, or Web3
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
      associations: this.associations,
    };
  }

  static async fromJSON(data, ethers) {
    const wallet = new RivetWallet();
    wallet.address = data.address;
    wallet.publicKey = data.publicKey;
    wallet.keyId = data.keyId;
    wallet.type = data.type || "Browser";
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
      wallet.keyId =
        "rivet-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
      wallet.createdAt = Date.now();
      wallet.lastUpdated = Date.now();
      wallet.label = "Browser Wallet";

      // Check if Web Crypto API is available
      if (!window.crypto || !window.crypto.subtle) {
        console.warn(
          "Web Crypto API not available, falling back to extractable keys",
        );
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
          name: "AES-GCM",
          length: 256,
        },
        false, // non-extractable!
        ["encrypt", "decrypt"],
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
          name: "AES-GCM",
          iv: iv,
        },
        masterKey,
        privateKeyBytes,
      );

      // Store encrypted private key and IV
      wallet.encryptedPrivateKey = JSON.stringify({
        encrypted: ethers.utils.hexlify(new Uint8Array(encryptedBuffer)),
        iv: ethers.utils.hexlify(iv),
      });

      return wallet;
    } catch (error) {
      console.error("Failed to create rivet wallet:", error);
      throw error;
    }
  }

  /**
   * Signs a message only (client-side)
   *
   * @param {object} message - blob of data to sign
   * @param {ethers} ethers - ethers.js instance
   * @returns {Promise<string>} Signed message as hex string
   */
  async sign(message, ethers) {
    try {
      // Retrieve master key from IndexedDB
      const masterKey = await RivetWallet.getMasterKey(this.keyId);
      if (!masterKey) {
        throw new Error(
          "Master key not found - rivet may have been created in a different browser context",
        );
      }

      // Decrypt the private key
      const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
      const encryptedBytes = ethers.utils.arrayify(encrypted);
      const ivBytes = ethers.utils.arrayify(iv);

      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ivBytes,
        },
        masterKey,
        encryptedBytes,
      );

      const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));

      // Create temporary signer and sign
      const signer = new ethers.Wallet(privateKey);
      const signature = await signer.signMessage(message);

      return signature;
    } catch (error) {
      console.error("Failed to sign message with rivet:", error);
      throw error;
    }
  }

  /**
   * Signs a complete transaction
   *
   * This is the core of client-side signing for RivetWallet.
   * The private key is temporarily decrypted, used to sign, then discarded.
   *
   * @param {object} unsignedTx - Unsigned transaction object from server
   * @param {ethers} ethers - ethers.js instance
   * @returns {Promise<string>} Signed transaction as hex string
   */
  async signTransaction(unsignedTx, ethers) {
    try {
      console.log("RivetWallet: Signing transaction");

      const masterKey = await RivetWallet.getMasterKey(this.keyId);
      if (!masterKey) {
        throw new Error(
          "Master key not found - rivet may have been created in a different browser context",
        );
      }

      const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
      const encryptedBytes = ethers.utils.arrayify(encrypted);
      const ivBytes = ethers.utils.arrayify(iv);

      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ivBytes,
        },
        masterKey,
        encryptedBytes,
      );

      const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));

      // NOTE: This wallet object exists only in this function scope.
      // When the function returns, the wallet and privateKey are garbage collected.
      const signer = new ethers.Wallet(privateKey);

      // Validate that our address matches
      const addressToValidate = this.rivetAddress || this.address;
      if (signer.address.toLowerCase() !== addressToValidate.toLowerCase()) {
        throw new Error("Decrypted key does not match rivet address");
      }

      const signedTx = await signer.signTransaction(unsignedTx);

      console.log("RivetWallet: Transaction signed successfully");
      return signedTx;
    } catch (error) {
      console.error("Failed to sign transaction with rivet:", error);
      throw error;
    }
  }

  // ECDH + AES-GCM encrypt for peer. Private key briefly decrypted in this
  // closure, used to derive the shared AES key, then goes out of scope.
  // Mirrors signTransaction's lifecycle exactly.
  async encryptForPeer(peerPublicKey, plaintextBytes, ethers) {
    const masterKey = await RivetWallet.getMasterKey(this.keyId);
    if (!masterKey) {
      throw new Error(
        "Master key not found - rivet may have been created in a different browser context",
      );
    }
    const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ethers.utils.arrayify(iv) },
      masterKey,
      ethers.utils.arrayify(encrypted),
    );
    const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));
    const aesKey = await _deriveAesKeyFromPriv(privateKey, peerPublicKey, ethers);
    // privateKey goes out of scope at function return; nothing keeps a ref.
    return await _aesGcmEncrypt(aesKey, plaintextBytes);
  }

  async decryptFromPeer(peerPublicKey, ciphertextBytes, ivBytes, tagBytes, ethers) {
    const masterKey = await RivetWallet.getMasterKey(this.keyId);
    if (!masterKey) {
      throw new Error(
        "Master key not found - rivet may have been created in a different browser context",
      );
    }
    const { encrypted, iv } = JSON.parse(this.encryptedPrivateKey);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ethers.utils.arrayify(iv) },
      masterKey,
      ethers.utils.arrayify(encrypted),
    );
    const privateKey = ethers.utils.hexlify(new Uint8Array(decryptedBuffer));
    const aesKey = await _deriveAesKeyFromPriv(privateKey, peerPublicKey, ethers);
    return await _aesGcmDecrypt(aesKey, ciphertextBytes, ivBytes, tagBytes);
  }

  // IndexedDB operations for storing non-extractable CryptoKey
  static async storeMasterKey(keyId, masterKey) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("EpisteryRivets", 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["masterKeys"], "readwrite");
        const store = transaction.objectStore("masterKeys");

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
        if (!db.objectStoreNames.contains("masterKeys")) {
          db.createObjectStore("masterKeys", { keyPath: "keyId" });
        }
      };
    });
  }

  static async getMasterKey(keyId) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("EpisteryRivets", 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["masterKeys"], "readonly");
        const store = transaction.objectStore("masterKeys");

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
        if (!db.objectStoreNames.contains("masterKeys")) {
          db.createObjectStore("masterKeys", { keyPath: "keyId" });
        }
      };
    });
  }

  // Identity Contract methods (opt-in, not automatic)

  /**
   * Deploys a new IdentityContract with this rivet as the first authorized signer
   * Uses the prepare → sign → submit architecture (server handles funding)
   * @param {ethers} ethers - ethers.js instance
   * @param {object} providerConfig - Provider configuration with rpc and chainId
   * @param {string} domain - Domain context for the deployment
   * @returns {Promise<string>} Contract address
   */
  async deployIdentityContract(ethers, providerConfig, domain = "localhost") {
    try {
      // Get rootPath from Witness singleton
      const rootPath =
        (typeof Witness !== "undefined" && Witness.instance?.rootPath) || "..";

      // Step 1: Prepare unsigned deployment transaction (server funds the wallet)
      const prepareResponse = await fetch(
        `${rootPath}/epistery/identity/prepare-deploy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientAddress: this.address,
            domain: domain,
          }),
        },
      );

      if (!prepareResponse.ok) {
        const error = await prepareResponse.json();
        throw new Error(
          `Failed to prepare deployment: ${error.error || prepareResponse.statusText}`,
        );
      }

      const { unsignedTransaction, metadata } = await prepareResponse.json();

      // Step 2: Sign the transaction client-side
      const signedTx = await this.signTransaction(unsignedTransaction, ethers);

      // Step 3: Submit signed transaction to blockchain
      const submitResponse = await fetch(
        `${rootPath}/epistery/data/submit-signed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signedTransaction: signedTx,
            operation: "deployIdentityContract",
            metadata: metadata,
          }),
        },
      );

      if (!submitResponse.ok) {
        const error = await submitResponse.json();
        throw new Error(
          `Failed to submit deployment: ${error.error || submitResponse.statusText}`,
        );
      }

      const receipt = await submitResponse.json();

      if (!receipt.contractAddress) {
        throw new Error(
          "Contract deployment succeeded but no contract address in receipt",
        );
      }

      // Upgrade this rivet to use the contract
      this.upgradeToContract(receipt.contractAddress);

      return receipt.contractAddress;
    } catch (error) {
      console.error("Failed to deploy IdentityContract:", error);
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
      expiresAt: Date.now() + 3600000, // 1 hour
    };

    // Sign the payload to prove this is a legitimate invitation
    const message = JSON.stringify(payload);
    const signature = await this.sign(message, ethers);

    const token = {
      payload,
      signature,
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
        throw new Error("Join token has expired");
      }

      // Get current rivet address
      const myRivetAddress = this.rivetAddress || this.address;

      // SECURITY: Verify this token was generated for THIS rivet's address
      if (
        payload.targetRivetAddress.toLowerCase() !==
        myRivetAddress.toLowerCase()
      ) {
        throw new Error(
          "This join token was not generated for your rivet address. Token is bound to: " +
            payload.targetRivetAddress,
        );
      }

      // The contract we're joining (from the token)
      const targetContract = payload.contractAddress;

      // Verify the signature from the inviter
      const message = JSON.stringify(payload);
      const recoveredAddress = ethers.utils.verifyMessage(message, signature);
      if (
        recoveredAddress.toLowerCase() !==
        payload.inviterRivetAddress.toLowerCase()
      ) {
        throw new Error("Invalid join token signature");
      }

      // Upgrade this rivet to use the contract as its identity
      this.upgradeToContract(targetContract);

      console.log("Rivet ready to join identity contract:", myRivetAddress);

      return {
        contractAddress: targetContract,
        myRivetAddress: myRivetAddress,
      };
    } catch (error) {
      console.error("Failed to accept join token:", error);
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
    let browser = "unknown";

    if (userAgent.includes("chrome") && !userAgent.includes("edg")) {
      browser = "chrome";
    } else if (userAgent.includes("firefox")) {
      browser = "firefox";
    } else if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      browser = "safari";
    } else if (userAgent.includes("edg")) {
      browser = "edge";
    } else if (userAgent.includes("opr") || userAgent.includes("opera")) {
      browser = "opera";
    }

    // Detect OS
    let os = "unknown";
    if (userAgent.includes("win")) {
      os = "windows";
    } else if (userAgent.includes("mac")) {
      os = "macos";
    } else if (userAgent.includes("linux")) {
      os = "linux";
    } else if (userAgent.includes("android")) {
      os = "android";
    } else if (userAgent.includes("iphone") || userAgent.includes("ipad")) {
      os = "ios";
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
      if (
        !normalizedURL.startsWith("http://") &&
        !normalizedURL.startsWith("https://")
      ) {
        normalizedURL = `https://${normalizedURL}`;
      }

      // Remove trailing slash if present
      normalizedURL = normalizedURL.replace(/\/$/, "");

      // Fetch epistery status from the site
      const response = await fetch(`${normalizedURL}/.well-known/epistery`);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch epistery info from ${normalizedURL}. Status: ${response.status}`,
        );
      }

      const data = await response.json();

      // The rivet address should be in client.walletAddress
      const rivetAddress = data.client?.walletAddress;

      if (!rivetAddress) {
        throw new Error(
          `No rivet address found at ${normalizedURL}. The site may not have Epistery enabled or no rivet is connected.`,
        );
      }

      return rivetAddress;
    } catch (error) {
      console.error("Failed to get rivet address from URL:", error);
      throw new Error(
        `Unable to get rivet address from "${url}": ${error.message}`,
      );
    }
  }

  /**
   * Adds another rivet to this identity contract (must be called by an authorized rivet)
   * Uses the prepare → sign → submit architecture (server handles funding)
   * @param {string} rivetAddressToAdd - The rivet address to add
   * @param {ethers} ethers - ethers.js instance
   * @param {object} providerConfig - Provider configuration with rpc
   * @param {string} rivetName - Optional name for the rivet (auto-generated if not provided)
   * @param {string} domain - Domain context for the transaction
   * @returns {Promise<void>}
   */
  async addRivetToContract(
    rivetAddressToAdd,
    ethers,
    providerConfig,
    rivetName = "",
    domain = "localhost",
  ) {
    try {
      if (!this.contractAddress) {
        throw new Error("This rivet is not part of an identity contract");
      }

      // Get rootPath from Witness singleton
      const rootPath =
        (typeof Witness !== "undefined" && Witness.instance?.rootPath) || "..";

      // Generate name if not provided (empty string is considered "not provided")
      const finalRivetName = rivetName || RivetWallet.generateRivetName();

      // Step 1: Prepare unsigned transaction (server funds the wallet)
      const prepareResponse = await fetch(
        `${rootPath}/identity/prepare-add-rivet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signerAddress: this.rivetAddress || this.address,
            contractAddress: this.contractAddress,
            rivetAddressToAdd: rivetAddressToAdd,
            rivetName: finalRivetName,
            domain: domain,
          }),
        },
      );

      if (!prepareResponse.ok) {
        const error = await prepareResponse.json();
        throw new Error(
          `Failed to prepare add rivet: ${error.error || prepareResponse.statusText}`,
        );
      }

      const { unsignedTransaction, metadata } = await prepareResponse.json();

      // Step 2: Sign the transaction client-side
      const signedTx = await this.signTransaction(unsignedTransaction, ethers);

      // Step 3: Submit signed transaction to blockchain
      const submitResponse = await fetch(
        `${rootPath}/epistery/data/submit-signed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signedTransaction: signedTx,
            operation: "addRivetToContract",
            metadata: metadata,
          }),
        },
      );

      if (!submitResponse.ok) {
        const error = await submitResponse.json();
        throw new Error(
          `Failed to submit add rivet: ${error.error || submitResponse.statusText}`,
        );
      }

      const receipt = await submitResponse.json();

      console.log(
        "Rivet added to identity contract:",
        rivetAddressToAdd,
        "with name:",
        finalRivetName,
      );
      return receipt;
    } catch (error) {
      console.error("Failed to add rivet to contract:", error);
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
        throw new Error("This rivet is not part of an identity contract");
      }

      // Get rootPath from Witness singleton
      const rootPath =
        (typeof Witness !== "undefined" && Witness.instance?.rootPath) || "..";

      const provider = new ethers.providers.JsonRpcProvider(providerConfig.rpc);

      // Load contract artifact
      const response = await fetch(
        `${rootPath}/epistery/artifacts/IdentityContract.json`,
      );
      const artifact = await response.json();

      // Connect to the identity contract (read-only, no signer needed)
      const contract = new ethers.Contract(
        this.contractAddress,
        artifact.abi,
        provider,
      );

      try {
        // Try to call getRivetsWithNames() (new contract version)
        const [addresses, names] = await contract.getRivetsWithNames();

        // Combine addresses and names into objects
        return addresses.map((address, index) => ({
          address: address,
          name: names[index] || "Unnamed Rivet",
        }));
      } catch (error) {
        // Fallback to getRivets() for old contracts that don't have names
        console.warn(
          "Contract does not support getRivetsWithNames(), falling back to getRivets()",
        );
        const addresses = await contract.getRivets();

        // Return addresses with default names
        return addresses.map((address) => ({
          address: address,
          name: "Unnamed Rivet (old contract)",
        }));
      }
    } catch (error) {
      console.error("Failed to get rivets from contract:", error);
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
      throw new Error("Rivet is already using an identity contract");
    }

    this.rivetAddress = this.address; // Save original rivet address
    this.address = contractAddress; // Present contract address
    this.contractAddress = contractAddress;
    this.type = "Contract";
    this.lastUpdated = Date.now();
  }
}

// Expose RivetWallet globally for browser access
if (typeof window !== "undefined") {
  window.RivetWallet = RivetWallet;
}

// FIDO/WebAuthn Wallet — PRF-wraps-rivet
//
// The FIDO credential lives in the Secure Enclave (ITP-exempt on iOS).
// WebAuthn PRF output derives an AES-256 key that wraps a freshly-generated
// secp256k1 rivet private key. The encrypted blob may live locally in the
// wallet JSON and/or be backed up to the epistery server (keyed by credential
// ID and domain) so it survives iOS ITP IndexedDB purges. See
// MobileIdentity.md for the full design and threat model.
const FIDO_PRF_INPUT = new TextEncoder().encode("epistery-fido-prf-v1");

export class FidoWallet extends Wallet {
  constructor() {
    super();
    this.source = "fido";
    this.credentialId = null; // base64url string
    this.encryptedPrivateKey = null; // JSON: { ciphertext, iv } as hex
    this.label = null;
    this.createdAt = null;
    this.lastUpdated = null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      credentialId: this.credentialId,
      encryptedPrivateKey: this.encryptedPrivateKey,
      label: this.label,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
    };
  }

  static async fromJSON(data, ethers) {
    const wallet = new FidoWallet();
    wallet.address = data.address;
    wallet.publicKey = data.publicKey;
    wallet.credentialId = data.credentialId;
    wallet.encryptedPrivateKey = data.encryptedPrivateKey;
    wallet.label = data.label;
    wallet.createdAt = data.createdAt;
    wallet.lastUpdated = data.lastUpdated;
    return wallet;
  }

  static _b64uEncode(bytes) {
    const s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  static _b64uDecode(s) {
    let padded = s.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Registration ceremony: create credential, derive PRF, return both.
  // Some authenticators don't return PRF on create() — follow up with get().
  static async _prfDeriveOnCreate(label) {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Epistery", id: window.location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: label || "epistery-user",
          displayName: label || "Epistery user",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        extensions: {
          prf: { eval: { first: FIDO_PRF_INPUT } },
        },
      },
    });

    let prfOutput =
      credential.getClientExtensionResults()?.prf?.results?.first;

    if (!prfOutput) {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: "public-key", id: credential.rawId }],
          userVerification: "required",
          extensions: { prf: { eval: { first: FIDO_PRF_INPUT } } },
        },
      });
      prfOutput =
        assertion.getClientExtensionResults()?.prf?.results?.first;
    }

    if (!prfOutput) {
      throw new Error(
        "Authenticator did not return PRF output — extension unsupported",
      );
    }

    return {
      credentialId: FidoWallet._b64uEncode(credential.rawId),
      prfBytes: new Uint8Array(prfOutput),
    };
  }

  // Unlock ceremony: prompt for credential, return PRF output.
  static async _prfDeriveOnGet(credentialId) {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [
          { type: "public-key", id: FidoWallet._b64uDecode(credentialId) },
        ],
        userVerification: "required",
        extensions: { prf: { eval: { first: FIDO_PRF_INPUT } } },
      },
    });

    const prfOutput =
      assertion.getClientExtensionResults()?.prf?.results?.first;
    if (!prfOutput) {
      throw new Error("PRF output missing from authenticator assertion");
    }
    return new Uint8Array(prfOutput);
  }

  static async _aesKeyFromPRF(prfBytes, usage) {
    return await crypto.subtle.importKey(
      "raw",
      prfBytes,
      { name: "AES-GCM" },
      false,
      usage,
    );
  }

  static _rootPath() {
    return (
      (typeof Witness !== "undefined" && Witness.instance?.rootPath) || ".."
    );
  }

  static async create(ethers, options = {}) {
    if (!window.PublicKeyCredential || !navigator.credentials?.create) {
      throw new Error("WebAuthn not available in this browser");
    }

    const wallet = new FidoWallet();
    wallet.label = options.label || "FIDO Wallet";
    wallet.createdAt = Date.now();
    wallet.lastUpdated = wallet.createdAt;

    const { credentialId, prfBytes } = await FidoWallet._prfDeriveOnCreate(
      wallet.label,
    );
    wallet.credentialId = credentialId;

    const aesKey = await FidoWallet._aesKeyFromPRF(prfBytes, ["encrypt"]);

    const ethersWallet = ethers.Wallet.createRandom();
    wallet.address = ethersWallet.address;
    wallet.publicKey = ethersWallet.publicKey;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const privateKeyBytes = ethers.utils.arrayify(ethersWallet.privateKey);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      privateKeyBytes,
    );

    const ciphertextHex = ethers.utils.hexlify(new Uint8Array(ciphertext));
    const ivHex = ethers.utils.hexlify(iv);

    wallet.encryptedPrivateKey = JSON.stringify({
      ciphertext: ciphertextHex,
      iv: ivHex,
    });

    // Back up the encrypted blob to the epistery server so it survives
    // local storage purges (iOS ITP). The server holds ciphertext only.
    if (!options.skipServerBackup) {
      try {
        await fetch(`${FidoWallet._rootPath()}/epistery/fido/blob`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credentialId: wallet.credentialId,
            rivetAddress: wallet.address,
            publicKey: wallet.publicKey,
            ciphertext: ciphertextHex,
            iv: ivHex,
            label: wallet.label,
          }),
        });
      } catch (e) {
        console.warn("FidoWallet: server backup failed, blob is local-only", e);
      }
    }

    return wallet;
  }

  // Fetch the encrypted blob from the epistery server (post-purge recovery).
  // Returns { ciphertext, iv } as hex strings, or null on failure.
  static async fetchBlob(credentialId) {
    try {
      const res = await fetch(
        `${FidoWallet._rootPath()}/epistery/fido/blob/${encodeURIComponent(credentialId)}`,
      );
      if (!res.ok) return null;
      const body = await res.json();
      if (!body?.ciphertext || !body?.iv) return null;
      return { ciphertext: body.ciphertext, iv: body.iv };
    } catch {
      return null;
    }
  }

  // Decrypts the rivet private key in memory via a fresh PRF ceremony.
  // Falls back to the server-stored blob if the local copy is missing
  // (the iOS ITP purge recovery path). Returns a hex private key — caller
  // is responsible for letting it go out of scope after signing.
  async _decryptPrivateKey(ethers) {
    if (!this.credentialId) {
      throw new Error("FidoWallet missing credentialId");
    }

    let blob = this.encryptedPrivateKey
      ? JSON.parse(this.encryptedPrivateKey)
      : null;

    if (!blob) {
      blob = await FidoWallet.fetchBlob(this.credentialId);
      if (!blob) {
        throw new Error(
          "FidoWallet: encrypted blob missing locally and on server",
        );
      }
      this.encryptedPrivateKey = JSON.stringify(blob);
    }

    const prfBytes = await FidoWallet._prfDeriveOnGet(this.credentialId);
    const aesKey = await FidoWallet._aesKeyFromPRF(prfBytes, ["decrypt"]);

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ethers.utils.arrayify(blob.iv) },
      aesKey,
      ethers.utils.arrayify(blob.ciphertext),
    );

    return ethers.utils.hexlify(new Uint8Array(plaintext));
  }

  async sign(message, ethers) {
    const privateKey = await this._decryptPrivateKey(ethers);
    const signer = new ethers.Wallet(privateKey);
    return await signer.signMessage(message);
  }

  async signTransaction(unsignedTx, ethers) {
    const privateKey = await this._decryptPrivateKey(ethers);
    const signer = new ethers.Wallet(privateKey);
    if (signer.address.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error("Decrypted key does not match FidoWallet address");
    }
    return await signer.signTransaction(unsignedTx);
  }

  // ECDH + AES-GCM peer encryption. Private key is unwrapped by the
  // FIDO authenticator via _decryptPrivateKey, used to derive the shared
  // AES key, then goes out of scope at return — same lifecycle as sign().
  async encryptForPeer(peerPublicKey, plaintextBytes, ethers) {
    const privateKey = await this._decryptPrivateKey(ethers);
    const aesKey = await _deriveAesKeyFromPriv(privateKey, peerPublicKey, ethers);
    return await _aesGcmEncrypt(aesKey, plaintextBytes);
  }

  async decryptFromPeer(peerPublicKey, ciphertextBytes, ivBytes, tagBytes, ethers) {
    const privateKey = await this._decryptPrivateKey(ethers);
    const aesKey = await _deriveAesKeyFromPriv(privateKey, peerPublicKey, ethers);
    return await _aesGcmDecrypt(aesKey, ciphertextBytes, ivBytes, tagBytes);
  }

  // Submit a whitelist access request for this rivet address.
  // The proposed `name` should match the existing name the user is known
  // by on this domain (Tier 1 multi-device-per-name).
  async requestWhitelisting({ name, listName, message } = {}) {
    if (!this.address) {
      throw new Error("FidoWallet has no address");
    }
    if (!listName) {
      throw new Error("listName is required");
    }
    const res = await fetch(
      `${FidoWallet._rootPath()}/epistery/whitelist/request-access`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: this.address,
          listName,
          name: name || this.label,
          walletType: "fido",
          message: message || "FIDO-backed device registration",
        }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Whitelist request failed: ${res.status}`);
    }
    return await res.json();
  }
}

if (typeof window !== "undefined") {
  window.FidoWallet = FidoWallet;
}
