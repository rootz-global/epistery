/*
 * Witness - Browser client for Epistery
 *
 * This is the browser-side client that connects to the Epistery server
 * and provides local wallet functionality for signing data
 */

import {
  Wallet,
  Web3Wallet,
  RivetWallet,
  FidoWallet,
} from "./wallet.js?v=7";

// Global ethers variable - will be loaded dynamically if needed
let ethers;

// Function to ensure ethers is loaded
async function ensureEthers() {
  if (ethers) return ethers;

  if (typeof window !== "undefined" && window.ethers) {
    ethers = window.ethers;
    return ethers;
  }

  // Get rootPath from Witness instance if available
  const rootPath = Witness.instance?.rootPath || "";

  // Dynamically import ethers from the epistery lib endpoint
  try {
    const ethersModule = await import(`${rootPath}/lib/ethers.js`);
    ethers = ethersModule.ethers || ethersModule.default || ethersModule;
    // Make it available globally for future use
    if (typeof window !== "undefined") {
      window.ethers = ethers;
    }
    return ethers;
  } catch (error) {
    console.error("Failed to load ethers.js:", error);
    throw new Error("ethers.js is required but not available");
  }
}

// --- Orphaned-rivet recovery -------------------------------------------------
// A RivetWallet is split across two per-origin stores: the rivet record
// (keyId + AES-encrypted private key) in localStorage["epistery"], and the
// non-extractable AES master key that decrypts it in IndexedDB
// (EpisteryRivets/masterKeys, keyed by keyId). Browsers evict IndexedDB far
// more aggressively than localStorage, so the master key can vanish while the
// rivet record survives. sign() then throws "Master key not found" on every
// connect(), and connect() never self-heals because it only mints a fresh
// rivet when there is NO wallet at all (see `if (!witness.wallet)` below).
//
// reset_master_key() is the manual recovery path: it finds rivet records whose
// master key is missing and removes those records so the next page load mints
// a fresh device key for this origin. It is intentionally NOT called from
// connect() — advise affected users to run reset_master_key() in the console
// until the impact of auto-healing is understood.
//
// Scope note: IndexedDB and localStorage are siloed per ORIGIN (scheme + host
// + port), stricter than cookies. This only ever touches the current origin;
// it cannot affect any other site. The cost is a NEW device address for THIS
// origin — anything bound to the old address here (follows, previously-signed
// messages) will not carry over.
async function reset_master_key({ confirm = true } = {}) {
  const raw = localStorage.getItem("epistery");
  if (!raw) {
    console.log(
      "[reset_master_key] No epistery storage on this origin — nothing to reset. Reload to mint a fresh device key.",
    );
    return { removed: 0, healthy: 0 };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn(
      "[reset_master_key] epistery storage is corrupt JSON; clearing it.",
      e,
    );
    localStorage.removeItem("epistery");
    setTimeout(() => location.reload(), 250);
    return { removed: -1, healthy: 0 };
  }

  // Support both the legacy single-wallet shape and the multi-wallet shape.
  const isMulti = Array.isArray(data.wallets);
  const entries = isMulti
    ? data.wallets
    : data.wallet
      ? [{ id: "legacy", wallet: data.wallet }]
      : [];

  const orphaned = [];
  let healthy = 0;
  for (const entry of entries) {
    const wal = entry.wallet || entry;
    if (!wal || wal.source !== "rivet") continue;
    const masterKey = wal.keyId
      ? await RivetWallet.getMasterKey(wal.keyId)
      : null;
    if (masterKey) {
      healthy++;
    } else {
      orphaned.push({ id: entry.id, keyId: wal.keyId, address: wal.address });
    }
  }

  if (orphaned.length === 0) {
    console.log(
      `[reset_master_key] No orphaned rivets found (${healthy} healthy). Nothing to do.`,
    );
    return { removed: 0, healthy };
  }

  console.log(
    `[reset_master_key] Found ${orphaned.length} orphaned rivet(s) — master key missing from IndexedDB:`,
    orphaned,
  );

  if (confirm && typeof window?.confirm === "function") {
    const ok = window.confirm(
      `Epistery: ${orphaned.length} device key(s) on ${location.host} can't be unlocked — ` +
        `the browser evicted their master key. Reset will mint a NEW device address for this site only. Continue?`,
    );
    if (!ok) {
      console.log("[reset_master_key] Cancelled — no changes made.");
      return { removed: 0, healthy, cancelled: true };
    }
  }

  if (isMulti) {
    const orphanIds = new Set(orphaned.map((o) => o.id));
    data.wallets = data.wallets.filter((w) => !orphanIds.has(w.id));
    if (orphanIds.has(data.defaultWalletId)) {
      data.defaultWalletId = data.wallets[0]?.id || null;
    }
    localStorage.setItem("epistery", JSON.stringify(data));
  } else {
    // Legacy shape: the single wallet is the orphan.
    localStorage.removeItem("epistery");
  }

  console.log(
    `[reset_master_key] Removed ${orphaned.length} orphaned rivet(s) (${healthy} healthy kept). Reloading to mint a fresh device key…`,
  );
  setTimeout(() => location.reload(), 250);
  return { removed: orphaned.length, healthy };
}

if (typeof window !== "undefined") {
  window.reset_master_key = reset_master_key;
}

export default class Witness {
  constructor(rootPath) {
    if (Witness.instance) return Witness.instance;
    Witness.instance = this;
    this.wallet = null;
    this.server = null;
    // Normalize rootPath - remove trailing slash, default to '..'
    this.rootPath = (rootPath || "..").replace(/\/$/, "");
    return this;
  }

  save() {
    const storageData = this.loadStorageData();

    // If current wallet exists, update or add it to the wallets array
    if (this.wallet) {
      const walletData = {
        id: this.wallet.id || this.generateWalletId(this.wallet.source),
        wallet: this.wallet.toJSON(),
        label:
          this.wallet.label ||
          (this.wallet.source === "web3" ? "Web3 Wallet" : "Browser Wallet"),
        createdAt: this.wallet.createdAt || Date.now(),
        lastUsed: Date.now(),
      };

      // Store the ID back on the wallet object
      this.wallet.id = walletData.id;
      this.wallet.label = walletData.label;
      this.wallet.createdAt = walletData.createdAt;

      // Update or add wallet in the array
      const existingIndex = storageData.wallets.findIndex(
        (w) => w.id === walletData.id,
      );
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

    localStorage.setItem("epistery", JSON.stringify(storageData));
  }

  loadStorageData() {
    const data = localStorage.getItem("epistery");
    if (!data) {
      return { wallets: [], defaultWalletId: null, server: null };
    }

    try {
      const parsed = JSON.parse(data);

      // Migrate old single-wallet format to new multi-wallet format
      if (parsed.wallet && !parsed.wallets) {
        const migratedWalletId = this.generateWalletId(parsed.wallet.source);
        return {
          wallets: [
            {
              id: migratedWalletId,
              wallet: parsed.wallet,
              label:
                parsed.wallet.source === "web3"
                  ? "Web3 Wallet"
                  : "Browser Wallet",
              createdAt: Date.now(),
              lastUsed: Date.now(),
            },
          ],
          defaultWalletId: migratedWalletId,
          server: parsed.server,
        };
      }

      return {
        wallets: parsed.wallets || [],
        defaultWalletId: parsed.defaultWalletId || null,
        server: parsed.server || null,
      };
    } catch (error) {
      console.error("Failed to parse epistery data:", error);
      return { wallets: [], defaultWalletId: null, server: null };
    }
  }

  async load() {
    const storageData = this.loadStorageData();

    this.server = storageData.server;

    // Check if migration happened and persist it immediately to avoid data loss
    const currentData = localStorage.getItem("epistery");
    if (currentData) {
      const parsed = JSON.parse(currentData);
      // If we migrated from old format (had wallet but no wallets), save the migration
      if (parsed.wallet && !parsed.wallets && storageData.wallets.length > 0) {
        console.log(
          "[epistery] Migrating old wallet format to multi-wallet format",
        );
        localStorage.setItem("epistery", JSON.stringify(storageData));
        console.log("[epistery] Migration complete - wallet preserved");
      }
    }

    // Load the default wallet if it exists (maintains backward compatibility)
    if (storageData.defaultWalletId && ethers) {
      const walletData = storageData.wallets.find(
        (w) => w.id === storageData.defaultWalletId,
      );
      if (walletData) {
        this.wallet = await Wallet.fromJSON(walletData.wallet, ethers);
        this.wallet.id = walletData.id;
        this.wallet.label = walletData.label;
        this.wallet.createdAt = walletData.createdAt;
      }
    }
  }

  generateWalletId(source) {
    let prefix = "browser-wallet"; // legacy default
    if (source === "web3") {
      prefix = "web3-wallet";
    } else if (source === "rivet") {
      prefix = "rivet";
    }
    return (
      prefix + "-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9)
    );
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

      // Establish mutual proof of identity
      if (!options.skipKeyExchange) {
        await witness.performKeyExchange();
      }
    } catch (e) {
      console.error("Failed to connect to Epistery server:", e);
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

      // Only try Web3 if user explicitly requests (not automatic).

      if (this.wallet) {
        console.log(
          `Wallet initialized: ${this.wallet.source} (${this.wallet.address})`,
        );
        this.save();
      } else {
        throw new Error("Failed to create rivet wallet");
      }
    } catch (e) {
      console.error("Failed to initialize wallet:", e);
    }
  }

  async fetchServerInfo() {
    try {
      const response = await fetch(this.rootPath||'/', {
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const serverInfo = await response.json();
        this.serverInfo = serverInfo.server;
      } else {
        throw new Error("Failed to fetch server info");
      }
    } catch (e) {
      console.error("Failed to fetch server info:", e);
    }
  }

  async ensureChainCompatibility() {
    if (!this.wallet || this.wallet.source !== "web3" || !this.serverInfo) {
      return;
    }

    try {
      const targetChainId = this.serverInfo.chainId;
      const targetRpc = this.serverInfo.rpc;

      // Get current chain ID
      const currentNetwork = await this.wallet.provider.getNetwork();

      // Parse server chain ID (remove comma if present)
      const expectedChainId = parseInt(
        targetChainId.toString().replace(",", ""),
      );

      if (currentNetwork.chainId !== expectedChainId) {
        await this.requestChainSwitch(
          expectedChainId,
          targetRpc,
          this.serverInfo.provider,
        );
      }
    } catch (e) {
      console.warn("Chain compatibility check failed:", e);
    }
  }

  async requestChainSwitch(chainId, rpcUrl, networkName) {
    if (!window.ethereum) {
      throw new Error("No Web3 provider available for chain switching");
    }

    try {
      // First, try to switch to the chain
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
    } catch (switchError) {
      // If the chain hasn't been added to MetaMask, add it
      if (switchError.code === 4902) {
        try {
          // Build nativeCurrency from serverInfo with sensible defaults
          const nativeCurrency = this.serverInfo?.nativeCurrency || {
            name: "ETH",
            symbol: "ETH",
            decimals: 18,
          };

          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${chainId.toString(16)}`,
                chainName: networkName || `Chain ${chainId}`,
                rpcUrls: [rpcUrl],
                nativeCurrency: nativeCurrency,
              },
            ],
          });
        } catch (addError) {
          console.error("Failed to add chain:", addError);
          throw addError;
        }
      } else {
        console.error("Failed to switch chain:", switchError);
        throw switchError;
      }
    }

    // Recreate the provider connection after chain switch
    if (this.wallet && this.wallet.source === "web3") {
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
        throw new Error("No wallet available for key exchange");
      }

      // For rivets with identity contracts, use the rivet address for signing
      // but present the contract address as the identity
      const signingAddress = this.wallet.rivetAddress || this.wallet.address;
      const identityAddress = this.wallet.address;

      // Check if session cookie already identifies this wallet
      try {
        const check = await fetch(`${this.rootPath}/connect`, { credentials: "include" });
        if (check.ok) {
          const session = await check.json();
          if (session.address && session.address.toLowerCase() === signingAddress.toLowerCase()) {
            return;
          }
        }
      } catch (e) {
        // No valid session, proceed with key exchange
      }

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
        identityAddress:
          identityAddress !== signingAddress ? identityAddress : undefined,
        contractAddress: this.wallet.contractAddress,
      };

      const response = await fetch(`${this.rootPath}/connect`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyExchangeData),
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
            rpcProxy: this.serverInfo?.rpcProxy,
            nativeCurrency: this.serverInfo?.nativeCurrency,
          };

          this.save();
          console.log("Key exchange completed successfully");
          console.log("Server address:", this.server.address);
        } else {
          throw new Error("Server identity verification failed");
        }
      } else {
        const errorResponse = await response.json();
        throw new Error(
          `Key exchange failed with status: ${response.status} - ${errorResponse.error || "Unknown error"}`,
        );
      }
    } catch (e) {
      console.error("Key exchange failed:", e);
      throw e;
    }
  }

  verifyServerIdentity(serverResponse) {
    try {
      // Reconstruct the message the server should have signed
      const expectedMessage = `Epistery Server Response - ${serverResponse.serverAddress} - ${serverResponse.challenge}`;

      // Verify the signature matches the server's public key
      const recoveredAddress = ethers.utils.verifyMessage(
        expectedMessage,
        serverResponse.signature,
      );
      return recoveredAddress === serverResponse.serverAddress;
    } catch (e) {
      console.error("Server identity verification error:", e);
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
      throw new Error("Wallet not initialized");
    }

    if (this.wallet.source === "rivet") {
      try {
        // STEP 1: Prepare
        const prepareResponse = await fetch(
          `${this.rootPath}/data/prepare-transfer-ownership`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientAddress: this.wallet.rivetAddress || this.wallet.address,
              futureOwnerAddress: futureOwnerWalletAddress,
              contractAddress: this.wallet.contractAddress || undefined,
            }),
          },
        );

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare: ${error.error}`);
        }

        const { transactions, totalEstimatedCost } =
          await prepareResponse.json();
        console.log(
          `Preparing ${transactions.length} transaction(s) with total estimated cost: ${totalEstimatedCost} ETH`,
        );

        await ensureEthers();
        const results = [];

        // STEP 2 & 3: Sign and Submit each transaction sequentially
        for (let i = 0; i < transactions.length; i++) {
          const { unsignedTransaction, metadata } = transactions[i];
          console.log(
            `[${i + 1}/${transactions.length}] Signing ${metadata.contractType} transfer...`,
          );

          // Sign
          const signedTx = await this.wallet.signTransaction(
            unsignedTransaction,
            ethers,
          );
          console.log(`[${i + 1}/${transactions.length}] Transaction signed`);

          // Submit
          const submitResponse = await fetch(
            "/.well-known/epistery/data/submit-signed",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                signedTransaction: signedTx,
                operation: "transferOwnership",
                metadata: metadata,
              }),
            },
          );

          if (!submitResponse.ok) {
            const error = await submitResponse.json();
            // If Agent transfer fails (no data), continue to IdentityContract
            if (
              metadata.contractType === "Agent" &&
              error.error?.includes("No data to transfer")
            ) {
              console.warn(
                `[${i + 1}/${transactions.length}] Agent transfer skipped (no data)`,
              );
              results.push({
                contractType: metadata.contractType,
                skipped: true,
                reason: "No data to transfer",
              });
              continue;
            }
            throw new Error(
              `Failed to submit ${metadata.contractType} transfer: ${error.error}`,
            );
          }

          const result = await submitResponse.json();
          console.log(
            `[${i + 1}/${transactions.length}] ${metadata.contractType} transfer confirmed`,
          );
          results.push({
            contractType: metadata.contractType,
            ...result,
          });
        }

        return {
          success: true,
          transfers: results,
          totalEstimatedCost,
        };
      } catch (error) {
        console.error(
          "Client-side signing for transferOwnership failed:",
          error,
        );
        throw error;
      }
    } else {
      // ===== OLD FLOW: Server-Side Signing =====
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
        walletType: this.wallet.source,
      };

      const result = await fetch(`${this.rootPath}/data/ownership`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientWalletInfo,
          futureOwnerWalletAddress,
          contractAddress: this.wallet.contractAddress || undefined,
        }),
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
      throw new Error("Wallet not initialized");
    }

    if (this.wallet.source === "rivet") {
      try {
        // STEP 1: Prepare
        const prepareResponse = await fetch(
          `${this.rootPath}/approval/prepare-create`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientAddress: this.wallet.rivetAddress || this.wallet.address,
              approverAddress,
              fileName,
              fileHash,
              domain,
            }),
          },
        );

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare: ${error.error}`);
        }

        const { unsignedTransaction, metadata } = await prepareResponse.json();

        // STEP 2: Sign
        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(
          unsignedTransaction,
          ethers,
        );

        // STEP 3: Submit
        const submitResponse = await fetch(
          `${this.rootPath}/data/submit-signed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedTransaction: signedTx,
              operation: "createApproval",
              metadata: metadata,
            }),
          },
        );

        if (!submitResponse.ok) {
          const error = await submitResponse.json();
          throw new Error(`Failed to submit: ${error.error}`);
        }

        return await submitResponse.json();
      } catch (error) {
        console.error("Client-side signing for createApproval failed:", error);
        throw error;
      }
    } else {
      // ===== OLD FLOW =====
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
        walletType: this.wallet.source,
      };

      const result = await fetch(`${this.rootPath}/approval/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientWalletInfo,
          approverAddress,
          fileName,
          fileHash,
          domain,
        }),
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
      throw new Error("Wallet not initialized");
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
      };

      let options = {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
        approverAddress: approverAddress,
        requestorAddress: requestorAddress,
      });

      let result = await fetch(`${this.rootPath}/approval/get`, options);

      if (result.ok) {
        return await result.json();
      } else {
        throw new Error(`Get approvals failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error("Failed to execute get approvals event:", e);
      throw e;
    }
  }

  async getAllApprovalsForApproverEvent(approverAddress) {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
      };

      let options = {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
        approverAddress: approverAddress,
      });

      let result = await fetch(`${this.rootPath}/approval/get-all`, options);

      if (result.ok) {
        return await result.json();
      } else {
        throw new Error(
          `Get all approvals failed with status: ${result.status}`,
        );
      }
    } catch (e) {
      console.error("Failed to execute get all approvals event:", e);
      throw e;
    }
  }

  async getAllApprovalsForRequestorEvent(requestorAddress) {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
      };

      let options = {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      options.body = JSON.stringify({
        clientWalletInfo: clientWalletInfo,
        requestorAddress: requestorAddress,
      });

      let result = await fetch(
        `${this.rootPath}/approval/get-all-requestor`,
        options,
      );

      if (result.ok) {
        return await result.json();
      } else {
        throw new Error(
          `Get all approvals for requestor failed with status: ${result.status}`,
        );
      }
    } catch (e) {
      console.error(
        "Failed to execute get all approvals for requestor event:",
        e,
      );
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
      throw new Error("Wallet not initialized");
    }

    if (this.wallet.source === "rivet") {
      try {
        // STEP 1: Prepare
        const prepareResponse = await fetch(
          `${this.rootPath}/approval/prepare-handle`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              approverAddress: this.wallet.rivetAddress || this.wallet.address,
              requestorAddress,
              fileName,
              approved,
              domain: window.location.hostname,
            }),
          },
        );

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare: ${error.error}`);
        }

        const { unsignedTransaction, metadata } = await prepareResponse.json();

        // STEP 2: Sign
        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(
          unsignedTransaction,
          ethers,
        );

        // STEP 3: Submit
        const submitResponse = await fetch(
          `${this.rootPath}/epistery/data/submit-signed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedTransaction: signedTx,
              operation: "handleApproval",
              metadata: metadata,
            }),
          },
        );

        if (!submitResponse.ok) {
          const error = await submitResponse.json();
          throw new Error(`Failed to submit: ${error.error}`);
        }

        return await submitResponse.json();
      } catch (error) {
        console.error("Client-side signing for handleApproval failed:", error);
        throw error;
      }
    } else {
      // ===== OLD FLOW =====
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
        walletType: this.wallet.source,
      };

      const result = await fetch(`${this.rootPath}/approval/handle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientWalletInfo,
          requestorAddress,
          fileName,
          approved,
        }),
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
      throw new Error("Wallet not initialized");
    }

    try {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
      };

      let options = {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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
      } else {
        throw new Error(`Read failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error("Failed to execute read event:", e);
      throw e;
    }
  }

  /**
   * Writes an event to the data wallet
   *
   * This method now supports TWO flows:
   * 1. NEW FLOW (RivetWallet): Client-side signing
   *    - prepare transaction → sign locally → submit signed tx
   * 2. OLD FLOW (Web3Wallet): Server-side signing
   *    - send mnemonic → server signs and broadcasts
   *
   * @param {any} data - Data to write
   * @returns {Promise<any>} Transaction receipt
   */
  async writeEvent(data) {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }

    if (this.wallet.source === "rivet") {
      try {
        const prepareResponse = await fetch(
          `${this.rootPath}/data/prepare-write`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientAddress: this.wallet.rivetAddress || this.wallet.address,
              publicKey: this.wallet.publicKey,
              data: data,
            }),
          },
        );

        if (!prepareResponse.ok) {
          const error = await prepareResponse.json();
          throw new Error(`Failed to prepare transaction: ${error.error}`);
        }

        const { unsignedTransaction, ipfsHash, metadata } =
          await prepareResponse.json();

        await ensureEthers();
        const signedTx = await this.wallet.signTransaction(
          unsignedTransaction,
          ethers,
        );
        const submitResponse = await fetch(
          `${this.rootPath}/data/submit-signed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedTransaction: signedTx,
              operation: "write",
              metadata: { ipfsHash, ...metadata },
            }),
          },
        );

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
          ipfsUrl: metadata.ipfsUrl,
        };
      } catch (error) {
        console.error("Client-side signing flow failed:", error);
        throw error;
      }
    } else {
      const clientWalletInfo = {
        address: this.wallet.rivetAddress || this.wallet.address,
        publicKey: this.wallet.publicKey,
        mnemonic: this.wallet.mnemonic || "",
        privateKey: this.wallet.privateKey || "",
        walletType: this.wallet.source, // 'browser' or 'web3'
      };

      const result = await fetch(`${this.rootPath}/data/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientWalletInfo, data }),
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
      wallets: storageData.wallets.map((w) => ({
        id: w.id,
        address: w.wallet.address,
        source: w.wallet.source,
        label: w.label,
        createdAt: w.createdAt,
        lastUsed: w.lastUsed,
        isDefault: w.id === storageData.defaultWalletId,
      })),
      defaultWalletId: storageData.defaultWalletId,
    };
  }

  async addWeb3Wallet(label = null) {
    await ensureEthers();
    const newWallet = await Web3Wallet.create(ethers);

    if (!newWallet) {
      throw new Error(
        "Failed to connect Web3 wallet. User may have cancelled or no Web3 provider available.",
      );
    }

    newWallet.label = label || "Web3 Wallet";

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
      label: newWallet.label,
    };
  }


  // Add another secure device wallet (an unextractable localStorage rivet,
  // shown to users as a "Browser Wallet"). Same shape as the deprecated
  // addBrowserWallet, minus the exposed private key — RivetWallet.create wraps
  // the secp256k1 key with a non-extractable WebCrypto master key. Lets one
  // device hold multiple independent, non-linked identities (one key, one
  // identity) the way Ledger/Trezor/MetaMask do.
  async addRivetWallet(label = null) {
    await ensureEthers();
    const newWallet = await RivetWallet.create(ethers);

    if (!newWallet) {
      throw new Error("Failed to create wallet");
    }

    newWallet.label = label || "Browser Wallet";

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
      label: newWallet.label,
    };
  }

  async addFidoWallet(label = null) {
    await ensureEthers();
    const newWallet = await FidoWallet.create(ethers, {
      label: label || "FIDO Wallet",
    });

    if (!newWallet) {
      throw new Error("Failed to create FIDO wallet");
    }

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
      label: newWallet.label,
    };
  }

  // Bind this origin's local rivet to an existing IdentityContract owned by
  // the user at another epistery host (defaults to epistery.io). This is the
  // cross-host counterpart of the in-browser `acceptJoinToken` flow — the
  // ferry that lets a user pick an authorized rivet on epistery.io to sign a
  // join token for a fresh rivet on `acme-host.example`.
  //
  // Flow:
  //   1. Ensure we have a local RivetWallet to register as the new rivet.
  //      If the current default isn't a Browser-type rivet, mint a fresh one.
  //   2. Open <issuerUrl>/auth in a popup, passing audience + nonce + the
  //      local rivet address as `targetRivetAddress`. The issuer's auth page
  //      drives `prepareAddRivetToContract` + `addRivet` on chain AND has
  //      the user's authorized rivet sign a join token bound to this rivet.
  //   3. Receive the base64 join token via postMessage. Call
  //      `localRivet.acceptJoinToken(joinToken)` — that verifies the
  //      signature, calls `upgradeToContract(contractAddress)`, and now the
  //      local rivet presents the contract address as its identity.
  //   4. Re-run key exchange so the host's server sees the new identity.
  async bindToEpisteryIdentity({
    issuerUrl = "https://epistery.io",
  } = {}) {
    await ensureEthers();

    // Step 1: ensure a local rivet that isn't already bound to a contract.
    let localRivet = this.wallet;
    const haveUsableRivet =
      localRivet &&
      localRivet.source === "rivet" &&
      !localRivet.contractAddress;
    if (!haveUsableRivet) {
      localRivet = await RivetWallet.create(ethers);
      localRivet.label = "Browser Wallet";
      this.wallet = localRivet;
      this.save();
    }

    // Step 2: open the issuer's auth popup and await the join token.
    const nonce = ethers.utils.hexlify(ethers.utils.randomBytes(16));
    const audience = location.host;
    const { joinToken, identityName, identityDomain, contractAddress, chainId } =
      await this._runEpisteryAuth(issuerUrl, {
        audience,
        nonce,
        target_rivet: localRivet.address,
      });

    if (!joinToken) {
      throw new Error("Issuer did not return a join token");
    }

    // Step 3: accept the token. acceptJoinToken verifies the signature
    // against the inviter's claim, then upgrades this rivet to present the
    // contract address (see RivetWallet.acceptJoinToken + upgradeToContract).
    await localRivet.acceptJoinToken(joinToken, ethers);

    // Best-effort metadata from the issuer — handy for the UI but the
    // authoritative identity is the contract on-chain.
    if (identityName) localRivet.label = identityDomain
      ? `${identityName}@${identityDomain}`
      : identityName;
    this.save();

    // Step 4: re-run key exchange so the host learns the new identity.
    // performKeyExchange now sees wallet.address == contractAddress and
    // wallet.rivetAddress == the original rivet, and posts both.
    //
    // The issuer's addRivet tx may still be confirming when we land here —
    // the host's /connect verifies on-chain isAuthorized, which won't pass
    // until the tx mines (~30s on Polygon). Retry with backoff so the
    // binding is robust without forcing the issuer to block on confirmation.
    let lastErr = null;
    const delays = [0, 5000, 10000, 15000, 20000, 30000]; // ~80s total
    for (const delay of delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        await this.performKeyExchange();
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        // Only retry on 401-ish (server rejected the contract claim).
        // Other errors (network, etc.) also retry — cheap and bounded.
      }
    }
    if (lastErr) throw lastErr;

    return {
      id: localRivet.id,
      address: localRivet.address,         // = contract
      rivetAddress: localRivet.rivetAddress,
      source: localRivet.source,
      label: localRivet.label,
      identityName: identityName || null,
      identityDomain: identityDomain || null,
      contractAddress: contractAddress || localRivet.contractAddress,
      chainId: chainId || null,
    };
  }

  // Open <issuerUrl>/auth in a popup and await a postMessage result.
  // The issuer's auth page posts `{type:"epistery-auth", joinToken, ...}`
  // back to this window when the user has approved and the inviter rivet
  // has signed a join token. Rejects on issuer error or popup close.
  async _runEpisteryAuth(issuerUrl, params) {
    const url = new URL("/auth", issuerUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const expectedOrigin = new URL(issuerUrl).origin;
    const popup = window.open(
      url.toString(),
      "epistery-auth",
      "width=480,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      throw new Error(
        `Popup blocked. Allow popups for ${location.host} to add an Epistery Identity.`,
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        window.removeEventListener("message", onMessage);
        clearInterval(closeWatcher);
      };
      const onMessage = (event) => {
        if (event.origin !== expectedOrigin) return;
        const msg = event.data;
        if (!msg || msg.type !== "epistery-auth") return;
        if (msg.error) {
          cleanup();
          try { popup.close(); } catch (e) {}
          reject(new Error(msg.error));
          return;
        }
        // The issuer posts whatever fields it has; callers care about
        // joinToken at minimum. Pass the whole payload through.
        cleanup();
        try { popup.close(); } catch (e) {}
        resolve(msg);
      };
      window.addEventListener("message", onMessage);

      // If the user closes the window before completing, surface that.
      const closeWatcher = setInterval(() => {
        if (settled) return;
        if (popup.closed) {
          cleanup();
          reject(new Error("Epistery auth window closed before completing"));
        }
      }, 500);
    });
  }

  async setDefaultWallet(walletId) {
    const storageData = this.loadStorageData();
    const walletData = storageData.wallets.find((w) => w.id === walletId);

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
    storageData.wallets = storageData.wallets.map((w) => {
      if (w.id === walletId) {
        w.lastUsed = Date.now();
      }
      return w;
    });

    localStorage.setItem("epistery", JSON.stringify(storageData));

    console.log(
      `Switched to wallet: ${this.wallet.source} (${this.wallet.address})`,
    );

    return {
      id: this.wallet.id,
      address: this.wallet.address,
      source: this.wallet.source,
      label: this.wallet.label,
    };
  }

  removeWallet(walletId) {
    const storageData = this.loadStorageData();

    // Don't allow removing the default wallet if it's the only one
    if (storageData.wallets.length === 1) {
      throw new Error("Cannot remove the only wallet");
    }

    // Don't allow removing the default wallet without switching first
    if (storageData.defaultWalletId === walletId) {
      throw new Error(
        "Cannot remove default wallet. Switch to another wallet first.",
      );
    }

    const walletIndex = storageData.wallets.findIndex((w) => w.id === walletId);
    if (walletIndex === -1) {
      throw new Error(`Wallet with ID ${walletId} not found`);
    }

    storageData.wallets.splice(walletIndex, 1);
    localStorage.setItem("epistery", JSON.stringify(storageData));

    return true;
  }

  updateWalletLabel(walletId, newLabel) {
    const storageData = this.loadStorageData();
    const walletData = storageData.wallets.find((w) => w.id === walletId);

    if (!walletData) {
      throw new Error(`Wallet with ID ${walletId} not found`);
    }

    walletData.label = newLabel;

    // If this is the current wallet, update it too
    if (this.wallet && this.wallet.id === walletId) {
      this.wallet.label = newLabel;
    }

    localStorage.setItem("epistery", JSON.stringify(storageData));

    return true;
  }

  getStatus() {
    return {
      client: this.wallet
        ? {
            address: this.wallet.rivetAddress || this.wallet.address,
            publicKey: this.wallet.publicKey,
            source: this.wallet.source,
          }
        : null,
      server: this.server,
      connected: !!(this.wallet && this.server),
    };
  }
}
