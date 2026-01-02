import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Epistery } from "./dist/epistery.js";
import { Utils } from "./dist/utils/Utils.js";
import { Config } from "./dist/utils/Config.js";
import createRoutes from "./routes/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Expected Agent contract version - must match contract VERSION constant
export const EXPECTED_CONTRACT_VERSION = "3.0.0";

// Helper function to get or create domain configurations src/utils/Config.ts system
function getDomainConfig(domain) {
  let domainConfig = Utils.GetDomainInfo(domain);
  if (!domainConfig?.wallet) {
    Utils.InitServerWallet(domain);
    domainConfig = Utils.GetDomainInfo(domain);
  }
  return domainConfig;
}

class EpisteryAttach {
  constructor(options = {}) {
    this.options = options;
    this.domain = null;
    this.domainName = null;
    this.config = new Config();
  }

  static async connect(options) {
    const attach = new EpisteryAttach(options);
    await Epistery.initialize();
    return attach;
  }

  async setDomain(domain) {
    this.domainName = domain;
    this.domain = getDomainConfig(domain);
  }

  async attach(app, rootPath) {
    this.rootPath = rootPath || "/.well-known/epistery";
    app.locals.epistery = this;

    // Domain middleware - set domain from hostname
    app.use(async (req, res, next) => {
      // Use req.headers.host and strip port for reliable subdomain detection
      // Express v5 req.hostname may not parse subdomains correctly
      const hostname = req.headers.host?.split(":")[0] || "localhost";
      if (req.app.locals.epistery.domain?.name !== hostname) {
        await req.app.locals.epistery.setDomain(hostname);
      }
      next();
    });

    // Authentication middleware - handle Bot auth and session cookies
    app.use(async (req, res, next) => {
      // 1. Check for Bot authentication (CLI/programmatic access)
      if (!req.episteryClient && req.headers.authorization?.startsWith("Bot ")) {
        try {
          const authHeader = req.headers.authorization.substring(4);
          const decoded = Buffer.from(authHeader, "base64").toString("utf8");
          const payload = JSON.parse(decoded);

          const { address, signature, message } = payload;

          if (address && signature && message) {
            // Verify the signature using ethers
            const { ethers } = await import("ethers");
            const recoveredAddress = ethers.utils.verifyMessage(message, signature);

            if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
              req.episteryClient = {
                address: address,
                authenticated: true,
                authType: "bot",
              };
            }
          }
        } catch (error) {
          console.error("[epistery] Bot auth error:", error.message);
          // Continue to try other auth methods
        }
      }

      // 2. Check for session cookie (_epistery)
      if (!req.episteryClient && req.cookies?._epistery) {
        try {
          const sessionData = JSON.parse(
            Buffer.from(req.cookies._epistery, "base64").toString("utf8"),
          );
          if (sessionData && sessionData.rivetAddress) {
            req.episteryClient = {
              address: sessionData.rivetAddress,
              publicKey: sessionData.publicKey,
              authenticated: sessionData.authenticated || false,
            };
          }
        } catch (e) {
          // Invalid session cookie, ignore
        }
      }
      next();
    });

    // Middleware to enrich request with notabot score
    app.use(async (req, res, next) => {
      // Check if client info is available (from key exchange or authentication)
      if (req.episteryClient && req.episteryClient.address) {
        try {
          // Get identity contract address if available
          // For now, we'll try to get it from query params or headers
          const identityContractAddress =
            req.query.identityContract || req.headers["x-identity-contract"];

          // Retrieve notabot score
          const notabotScore = await Epistery.getNotabotScore(
            req.episteryClient.address,
            identityContractAddress,
          );

          // Enrich client info with notabot data
          req.episteryClient.notabotPoints = notabotScore.points;
          req.episteryClient.notabotLastUpdate = notabotScore.lastUpdate;
          req.episteryClient.notabotVerified = notabotScore.verified;
          req.episteryClient.notabotEventCount = notabotScore.eventCount;

          // Also make it available at the documented location
          if (!req.app.epistery.clientWallet) {
            req.app.epistery.clientWallet = {};
          }
          req.app.epistery.clientWallet = Object.assign(
            req.app.epistery.clientWallet,
            req.episteryClient,
          );
        } catch (error) {
          // Log error but don't fail the request
          console.error(
            "[Epistery] Failed to retrieve notabot score:",
            error.message,
          );
        }
      }
      next();
    });

    // Mount routes - RFC 8615 compliant well-known URI
    app.use(this.rootPath, this.routes());
  }

  /**
   * Get a list for the current server domain
   * @param {string} listName - Name of the list (e.g., "example.com::admin")
   * @returns {Promise<Array>} Array of list entries
   */
  async getList(listName) {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    if (!listName) {
      throw new Error("List name is required");
    }

    // Initialize server wallet if not already done
    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const contractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("Agent contract address not configured for domain");
    }

    return await Utils.GetWhitelist(
      serverWallet,
      this.domain.wallet.address,
      listName,
      contractAddress,
    );
  }

  /**
   * Check if an address is on a list for the current server domain
   * @param {string} address - The address to check
   * @param {string} listName - Name of the list to check
   * @returns {Promise<boolean>} True if address is on the list
   */
  async isListed(address, listName) {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    if (!listName) {
      throw new Error("List name is required");
    }

    // Initialize server wallet if not already done
    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const contractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("Agent contract address not configured for domain");
    }

    return await Utils.IsWhitelisted(
      serverWallet,
      this.domain.wallet.address,
      listName,
      address,
      contractAddress,
    );
  }

  /**
   * Get all list memberships for a specific address
   * @param {string} address - The address to look up
   * @returns {Promise<Array>} Array of membership entries with listName, role, addedAt
   */
  async getListsForMember(address) {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    if (!address) {
      throw new Error("Address is required");
    }

    // Initialize server wallet if not already done
    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const contractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("Agent contract address not configured for domain");
    }

    return await Utils.GetListsForMember(
      serverWallet,
      this.domain.wallet.address,
      address,
      contractAddress,
    );
  }

  /**
   * Get the contract sponsor (owner) address
   * @returns {Promise<string>} The sponsor's Ethereum address
   */
  async getSponsor() {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const contractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("Agent contract address not configured for domain");
    }

    // Get provider from domain config
    const providerConfig = this.config.data?.provider;
    if (!providerConfig || !providerConfig.rpc) {
      throw new Error("Provider not configured for domain");
    }

    // Create ethers provider and contract
    const { ethers } = await import("ethers");
    const provider = new ethers.providers.JsonRpcProvider(providerConfig.rpc);

    // Load contract ABI using fs like other methods in this file
    const AgentArtifact = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "artifacts/contracts/agent.sol/Agent.json"),
        "utf8",
      ),
    );

    const contract = new ethers.Contract(
      contractAddress,
      AgentArtifact.abi,
      provider,
    );

    return await contract.sponsor();
  }

  /**
   * Add an address to a named list
   * @param {string} listName - Name of the list
   * @param {string} address - Ethereum address to add
   * @param {string} name - Display name
   * @param {number} role - Role (0-4)
   * @param {string} meta - Metadata JSON string
   */
  async addToList(listName, address, name = "", role = 0, meta = "") {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    if (!listName) {
      throw new Error("List name is required");
    }

    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const contractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("Agent contract address not configured for domain");
    }

    return await Utils.AddToWhitelist(
      serverWallet,
      listName,
      address,
      name,
      role,
      meta,
      contractAddress,
    );
  }

  /**
   * Remove an address from a named list
   * @param {string} listName - Name of the list
   * @param {string} address - Ethereum address to remove
   */
  async removeFromList(listName, address) {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    if (!listName) {
      throw new Error("List name is required");
    }

    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const contractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("Agent contract address not configured for domain");
    }

    return await Utils.RemoveFromWhitelist(
      serverWallet,
      listName,
      address,
      contractAddress,
    );
  }

  /**
   * Check if the deployed contract needs upgrade
   * @returns {Promise<Object>} Version comparison result
   */
  async checkContractVersion() {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    // Get contract address from domain config - reload from disk to get latest
    this.config.setPath(`/${this.domainName}`);
    this.config.load(); // Force reload from disk
    const agentContractAddress = this.config.data?.agent_contract_address;
    const upgradeNotes = this.config.data?.contract_upgrade_notes;

    if (
      !agentContractAddress ||
      agentContractAddress === "0x0000000000000000000000000000000000000000"
    ) {
      return {
        needsUpgrade: true,
        reason: "no_contract",
        deployedVersion: null,
        expectedVersion: EXPECTED_CONTRACT_VERSION,
        contractAddress: null,
        notes: upgradeNotes,
      };
    }

    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    try {
      // Load contract ABI - use readFileSync since dynamic import with assertions is problematic
      const AgentArtifact = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "artifacts/contracts/agent.sol/Agent.json"),
          "utf8",
        ),
      );

      const { ethers } = await import("ethers");
      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        serverWallet,
      );

      // Try to get VERSION from contract
      let deployedVersion = null;
      try {
        deployedVersion = await agentContract.VERSION();
      } catch (error) {
        // Contract doesn't have VERSION field (old version)
        deployedVersion = "1.0.0"; // Assume old version
      }

      const needsUpgrade = deployedVersion !== EXPECTED_CONTRACT_VERSION;

      return {
        needsUpgrade,
        reason: needsUpgrade ? "version_mismatch" : "up_to_date",
        deployedVersion,
        expectedVersion: EXPECTED_CONTRACT_VERSION,
        contractAddress: agentContractAddress,
        notes: upgradeNotes,
      };
    } catch (error) {
      return {
        needsUpgrade: true,
        reason: "check_failed",
        error: error.message,
        deployedVersion: null,
        expectedVersion: EXPECTED_CONTRACT_VERSION,
        contractAddress: agentContractAddress,
        notes: upgradeNotes,
      };
    }
  }

  /**
   * Get all list names for the current domain
   * @returns {Promise<string[]>} Array of list names
   */
  async getLists() {
    if (!this.domain?.wallet) {
      throw new Error("Server wallet not initialized for domain");
    }

    if (!this.domainName) {
      throw new Error("Domain name not set");
    }

    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error("Server wallet not connected");
    }

    // Get contract address from domain config
    this.config.setPath(`/${this.domainName}`);
    const agentContractAddress =
      this.config.data?.agent_contract_address ||
      process.env.AGENT_CONTRACT_ADDRESS;
    if (
      !agentContractAddress ||
      agentContractAddress === "0x0000000000000000000000000000000000000000"
    ) {
      throw new Error("Agent contract address not configured for domain");
    }

    const AgentArtifact = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "artifacts/contracts/agent.sol/Agent.json"),
        "utf8",
      ),
    );

    const { ethers } = await import("ethers");
    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      serverWallet,
    );

    const listNames = await agentContract.getListNames(
      this.domain.wallet.address,
    );
    return listNames;
  }

  /**
   * Update a list entry
   * @param {string} listName - Name of the list
   * @param {string} address - Ethereum address
   * @param {string} name - Display name
   * @param {number} role - Role (0-4)
   * @param {string} meta - Metadata JSON string
   */
  async updateEntry(listName, address, name, role, meta) {
    // For now, update is done by removing and re-adding
    await this.removeFromList(listName, address);
    await this.addToList(listName, address, name, role, meta);
  }

  /**
   * Build status JSON object
   * @returns {Object} Status object with server, client, and ipfs info
   */
  buildStatus() {
    const serverWallet = this.domain;

    return {
      server: {
        walletAddress: serverWallet?.wallet?.address || null,
        publicKey: serverWallet?.wallet?.publicKey || null,
        provider: serverWallet?.provider?.name || "Polygon Mainnet",
        chainId: serverWallet?.provider?.chainId?.toString() || "137",
        rpc: serverWallet?.provider?.rpc || "https://polygon-rpc.com",
        nativeCurrency: {
          symbol: serverWallet?.provider?.nativeCurrency?.symbol || "POL",
          name: serverWallet?.provider?.nativeCurrency?.name || "POL",
          decimals: serverWallet?.provider?.nativeCurrency?.decimals || 18,
        },
      },
      client: {},
      ipfs: {
        url: process.env.IPFS_URL || "https://rootz.digital/api/v0",
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Creates and returns the router with all Epistery routes
   *
   * Route structure (all mounted under /.well-known/epistery/):
   *   /                     - Status (JSON/HTML)
   *   /status               - Status page (HTML)
   *   /lib/:module          - Client library files
   *   /artifacts/:file      - Contract artifacts
   *   /connect              - Key exchange
   *   /create               - Create wallet
   *   /auth/*               - Authentication & domain claiming
   *   /data/*               - Data read/write/ownership
   *   /approval/*           - Approval system
   *   /identity/*           - Identity contract management
   *   /domain/*             - Domain initialization
   *   /notabot/*            - Notabot scoring
   *   /lists                - Get all lists
   *   /list                 - Get specific list
   *   /list/check/:address  - Check list membership
   *   /contract/*           - Contract version info
   *
   * @returns {express.Router}
   */
  routes() {
    return createRoutes(this);
  }
}

export { EpisteryAttach as Epistery, Config };
