import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Epistery } from "./dist/epistery.js";
import { Utils } from "./dist/utils/Utils.js";
import { Config } from "./dist/utils/Config.js";
import { chainFor, registerChain, configuredChains, defaultChainId, Chain } from "./dist/chains/index.js";
import createRoutes from "./routes/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  /**
   * Get the server wallet as an ethers.js Signer for the current domain.
   * Used by OAuthServer, MCPServer, and agents that need signing capability.
   */
  get signer() {
    if (!this.domainName) return null;
    return Utils.InitServerWallet(this.domainName) || null;
  }

  /**
   * Resolve a session from any HTTP-like request — works in the express
   * middleware path (where `req.cookies` is populated by cookie-parser) and
   * in raw contexts like a WebSocket upgrade (where only `req.headers.cookie`
   * is available). Mirrors the auth pathways the attach() middleware uses,
   * minus the name enrichment, which stays a middleware-only concern.
   *
   * Returns {signerAddress, identityAddress, contractAddress, publicKey,
   * authenticated, authType} or null. identityAddress is derived as
   * contractAddress || signerAddress and is always non-null when the rest is.
   */
  async resolveClient(req) {
    // 1. Bot auth (CLI / programmatic). Today the bot wire proves a signer
    // only; contractAddress stays null. A future bot path that wants to
    // claim a contract will sign a contract claim and the server will
    // verify isAuthorized — same shape as cookie sessions.
    if (req?.headers?.authorization?.startsWith("Bot ")) {
      try {
        const authHeader = req.headers.authorization.substring(4);
        const decoded = Buffer.from(authHeader, "base64").toString("utf8");
        const payload = JSON.parse(decoded);
        const { address, signature, message } = payload;
        if (address && signature && message) {
          const { ethers } = await import("ethers");
          const recoveredAddress = ethers.utils.verifyMessage(message, signature);
          if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
            return {
              signerAddress: address,
              contractAddress: null,
              identityAddress: address,
              authenticated: true,
              authType: "bot",
            };
          }
        }
      } catch (error) {
        console.error("[epistery] Bot auth error:", error.message);
      }
    }

    // 2. Session cookie (_epistery). Prefer the express-parsed jar; fall
    // back to parsing the raw Cookie header so WS upgrades work too.
    let cookieValue = req?.cookies?._epistery;
    if (!cookieValue && req?.headers?.cookie) {
      for (const part of req.headers.cookie.split(";")) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        if (trimmed.slice(0, eq) !== "_epistery") continue;
        cookieValue = decodeURIComponent(trimmed.slice(eq + 1));
        break;
      }
    }
    if (cookieValue) {
      try {
        const s = JSON.parse(
          Buffer.from(cookieValue, "base64").toString("utf8"),
        );
        if (s?.signerAddress) {
          return {
            signerAddress: s.signerAddress,
            contractAddress: s.contractAddress || null,
            identityAddress: s.contractAddress || s.signerAddress,
            publicKey: s.publicKey,
            authenticated: !!s.authenticated,
            authType: "cookie",
          };
        }
      } catch {
        // Invalid session cookie — fall through to null.
      }
    }
    return null;
  }

  async attach(app, rootPath) {
    this.rootPath = rootPath || "/.well-known/epistery";
    app.locals.epistery = this;

    // Domain middleware - set domain from hostname
    app.use(async (req, res, next) => {
      // req.hostname respects Express trust-proxy and X-Forwarded-Host,
      // which is required for internal proxies (MCP loopback fetch).
      // Falls back to raw Host header for non-proxied requests.
      const hostname = req.hostname || req.headers.host?.split(":")[0] || "localhost";
      if (req.app.locals.epistery.domainName !== hostname) {
        await req.app.locals.epistery.setDomain(hostname);
      }
      next();
    });

    // Authentication middleware — sets req.episteryClient to the three-fact
    // shape: { signerAddress, contractAddress, identityAddress, publicKey,
    // authenticated, authType }. signerAddress is the proven rivet,
    // contractAddress is a verified IdentityContract (or null), and
    // identityAddress is derived (contractAddress || signerAddress).
    // Downstream code authorizes against identityAddress.
    app.use(async (req, res, next) => {
      // 1. Bot authentication (CLI / programmatic). Signer-only today;
      // no contract claim path in the bot wire.
      if (!req.episteryClient && req.headers.authorization?.startsWith("Bot ")) {
        try {
          const authHeader = req.headers.authorization.substring(4);
          const decoded = Buffer.from(authHeader, "base64").toString("utf8");
          const payload = JSON.parse(decoded);

          const { address, signature, message } = payload;

          if (address && signature && message) {
            const { ethers } = await import("ethers");
            const recoveredAddress = ethers.utils.verifyMessage(message, signature);

            if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
              req.episteryClient = {
                signerAddress: address,
                contractAddress: null,
                identityAddress: address,
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

      // 2. Session cookie (_epistery). Set at /connect after signer proof and
      // (if a contract was claimed) on-chain isAuthorized verification.
      if (!req.episteryClient && req.cookies?._epistery) {
        try {
          const s = JSON.parse(
            Buffer.from(req.cookies._epistery, "base64").toString("utf8"),
          );
          if (s?.signerAddress) {
            req.episteryClient = {
              signerAddress: s.signerAddress,
              contractAddress: s.contractAddress || null,
              identityAddress: s.contractAddress || s.signerAddress,
              publicKey: s.publicKey,
              authenticated: !!s.authenticated,
              authType: "cookie",
            };
          }
        } catch (e) {
          // Invalid session cookie, ignore
        }
      }
      next();
    });

    // Mount routes - RFC 8615 compliant well-known URI
    app.use(this.rootPath, this.routes());
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

export { EpisteryAttach as Epistery, Config, chainFor, registerChain, configuredChains, defaultChainId, Chain };
