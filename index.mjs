import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Epistery } from "./dist/epistery.js";
import { Utils } from './dist/utils/Utils.js';
import { Config } from './dist/utils/Config.js';

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
    this.config = new Config()
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

  async attach(app,rootPath) {
    this.rootPath = rootPath || '.well-known/epistery';
    app.locals.epistery = this;

    app.use(async (req, res, next) => {
      if (req.app.locals.epistery.domain?.name !== req.hostname) {
        await req.app.locals.epistery.setDomain(req.hostname);
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
          const identityContractAddress = req.query.identityContract || req.headers['x-identity-contract'];

          // Retrieve notabot score
          const notabotScore = await Epistery.getNotabotScore(
            req.episteryClient.address,
            identityContractAddress
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
            req.episteryClient
          );

        } catch (error) {
          // Log error but don't fail the request
          console.error('[Epistery] Failed to retrieve notabot score:', error.message);
        }
      }
      next();
    });

    // Mount routes - RFC 8615 compliant well-known URI
    app.use(this.rootPath, this.routes());
  }

  /**
   * Get the whitelist for the current server domain
   * @returns {Promise<string[]>} Array of whitelisted addresses
   */
  async getWhitelist() {
    if (!this.domain?.wallet) {
      throw new Error('Server wallet not initialized for domain');
    }

    if (!this.domainName) {
      throw new Error('Domain name not set');
    }

    // Initialize server wallet if not already done
    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error('Server wallet not connected');
    }

    return await Utils.GetWhitelist(
      serverWallet,
      this.domain.wallet.address
    );
  }

  /**
   * Check if an address is whitelisted for the current server domain
   * @param {string} address - The address to check
   * @returns {Promise<boolean>} True if address is whitelisted
   */
  async isWhitelisted(address) {
    if (!this.domain?.wallet) {
      throw new Error('Server wallet not initialized for domain');
    }

    if (!this.domainName) {
      throw new Error('Domain name not set');
    }

    // Initialize server wallet if not already done
    const serverWallet = Utils.InitServerWallet(this.domainName);
    if (!serverWallet) {
      throw new Error('Server wallet not connected');
    }

    return await Utils.IsWhitelisted(
      serverWallet,
      this.domain.wallet.address,
      address
    );
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
        provider: serverWallet?.provider?.name || 'Polygon Mainnet',
        chainId: serverWallet?.provider?.chainId?.toString() || '137',
        rpc: serverWallet?.provider?.rpc || 'https://polygon-rpc.com',
        nativeCurrency: {
          symbol: serverWallet?.provider?.nativeCurrency?.symbol || 'POL',
          name: serverWallet?.provider?.nativeCurrency?.name || 'POL',
          decimals: serverWallet?.provider?.nativeCurrency?.decimals || 18
        }
      },
      client: {},
      ipfs: {
        url: process.env.IPFS_URL || 'https://rootz.digital/api/v0'
      },
      timestamp: new Date().toISOString()
    };
  }

  routes() {
    const router = express.Router();

    // Root endpoint - returns JSON for API clients, HTML for browsers
    router.get('/', (req, res) => {
      // Check if client wants JSON (API request)
      const acceptsJson = req.accepts('json') && !req.accepts('html');

      if (acceptsJson) {
        return res.json(this.buildStatus());
      }

      // Return HTML for browsers
      const domain = req.hostname;
      const serverWallet = this.domain;

      // Determine the root path from the request's base URL
      // baseUrl will be '/' or '/.well-known/epistery' depending on mount point
      const rootPath = req.baseUrl || '/';

      const templatePath = path.resolve(__dirname, 'client/status.html');
      if (!fs.existsSync(templatePath)) {
        return res.status(404).send('Status template not found');
      }

      let template = fs.readFileSync(templatePath, 'utf8');

      // Template replacement
      template = template.replace(/\{\{server\.domain\}\}/g, domain);
      template = template.replace(/\{\{server\.walletAddress\}\}/g, serverWallet?.wallet?.address || '');
      template = template.replace(/\{\{server\.provider\}\}/g, serverWallet?.provider?.name || '');
      template = template.replace(/\{\{server\.chainId\}\}/g, serverWallet?.provider?.chainId?.toString() || '');
      template = template.replace(/\{\{timestamp\}\}/g, new Date().toISOString());
      template = template.replace(/\{\{epistery\.rootPath\}\}/g, rootPath);

      res.send(template);
    });

    // Client library files
    const library = {
      "client.js": path.resolve(__dirname, "client/client.js"),
      "witness.js": path.resolve(__dirname, "client/witness.js"),
      "wallet.js": path.resolve(__dirname, "client/wallet.js"),
      "notabot.js": path.resolve(__dirname, "client/notabot.js"),
      "export.js": path.resolve(__dirname, "client/export.js"),
      "delegation.js": path.resolve(__dirname, "client/delegation.js"),
      "ethers.js": path.resolve(__dirname, "client/ethers.js"),
      "ethers.min.js": path.resolve(__dirname, "client/ethers.min.js")
    };

    // Serve client library files
    router.get('/lib/:module', (req, res) => {
      const modulePath = library[req.params.module];
      if (!modulePath) return res.status(404).send('Library not found');

      if (!fs.existsSync(modulePath)) return res.status(404).send('File not found');

      const ext = modulePath.slice(modulePath.lastIndexOf('.') + 1);
      const contentTypes = {
        'js': 'text/javascript',
        'mjs': 'text/javascript',
        'css': 'text/css',
        'html': 'text/html',
        'json': 'application/json'
      };

      if (contentTypes[ext]) {
        res.set('Content-Type', contentTypes[ext]);
      }

      res.sendFile(modulePath);
    });

    // Serve contract artifacts
    router.get('/artifacts/:contractFile', (req, res) => {
      const contractFile = req.params.contractFile;
      const artifactPath = path.resolve(__dirname, 'artifacts/contracts', contractFile.replace('.json', '.sol'), contractFile);

      if (!fs.existsSync(artifactPath)) {
        return res.status(404).send('Contract artifact not found');
      }

      res.set('Content-Type', 'application/json');
      res.sendFile(artifactPath);
    });

    router.get('/status', (req, res) => {
      const domain = req.hostname;
      const serverWallet = this.domain;

      // Determine the root path from the request's base URL
      const rootPath = req.baseUrl;

      const templatePath = path.resolve(__dirname, 'client/status.html');
      if (!fs.existsSync(templatePath)) {
        return res.status(404).send('Status template not found');
      }

      let template = fs.readFileSync(templatePath, 'utf8');

      // Template replacement
      template = template.replace(/\{\{server\.domain\}\}/g, domain);
      template = template.replace(/\{\{server\.walletAddress\}\}/g, serverWallet?.wallet?.address || '');
      template = template.replace(/\{\{server\.provider\}\}/g, serverWallet?.provider?.name || '');
      template = template.replace(/\{\{server\.chainId\}\}/g, serverWallet?.provider?.chainId?.toString() || '');
      template = template.replace(/\{\{timestamp\}\}/g, new Date().toISOString());
      template = template.replace(/\{\{epistery\.rootPath\}\}/g, rootPath);

      res.send(template);
    });

    // Delegation approval UI
    router.get('/delegate', (req, res) => {
      const rootPath = req.baseUrl || '/';
      const templatePath = path.resolve(__dirname, 'client/delegate.html');

      if (!fs.existsSync(templatePath)) {
        return res.status(404).send('Delegation template not found');
      }

      let template = fs.readFileSync(templatePath, 'utf8');
      template = template.replace(/\{\{epistery\.rootPath\}\}/g, rootPath);

      res.send(template);
    });

    // Key exchange endpoint - handles POST requests for key exchange
    router.post('/connect', async (req, res) => {
      try {
        const data = req.body;
        if (!data && Object.keys(data).length <= 0)
          data = req.body;

        const serverWallet = this.domain;

        if (!serverWallet?.wallet) {
          return res.status(500).json({ error: 'Server wallet not found' });
        }

        // Handle key exchange request
        const keyExchangeResponse = await Epistery.handleKeyExchange(data, serverWallet.wallet);

        if (!keyExchangeResponse) {
          return res.status(401).json({ error: 'Key exchange failed - invalid client credentials' });
        }
        const clientInfo = {
          address: data.clientAddress,
          publicKey: data.clientPublicKey
        }
        if (this.options.authentication) {
          clientInfo.profile = await this.options.authentication.call(this.options.authentication,clientInfo);
          clientInfo.authenticated = !!clientInfo.profile;
        }
        req.episteryClient = clientInfo;

        // Call onAuthenticated hook if provided
        if (this.options.onAuthenticated && clientInfo.authenticated) {
          await this.options.onAuthenticated(clientInfo, req, res);
        }

        res.json(Object.assign(keyExchangeResponse,{profile:clientInfo.profile,authenticated:clientInfo.authenticated}));
      } catch (error) {
        console.error('Key exchange error:', error);
        res.status(500).json({ error: 'Internal server error during key exchange' });
      }
    });

    router.get('/create', (req, res) => {
      const wallet = Epistery.createWallet();
      res.json({ wallet });
    });

    router.post('/data/write', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, data } = body;

        if (!clientWalletInfo || !data) {
          return res.status(400).json({ error: 'Missing client wallet or data' });
        }

        const result = await Epistery.write(clientWalletInfo, data);
        if (!result) {
          return res.status(500).json({ error: 'Write operation failed' });
        }

        res.json(result);
      }
      catch (error) {
        console.error('Write error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.post('/data/read', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo } = body;

        if (!clientWalletInfo) {
          return res.status(400).json({ error: 'Missing client wallet' });
        }

        const result = await Epistery.read(clientWalletInfo);
        if (!result) {
          return res.status(204);
        }

        res.json(result);
      }
      catch (error) {
        console.error('Read error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.put('/data/ownership', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, futureOwnerWalletAddress } = body;

        if (!clientWalletInfo || !futureOwnerWalletAddress) {
          return res.status(400).json({ error: 'Missing either client wallet or future owner address.' });
        }

        const result = await Epistery.transferOwnership(clientWalletInfo, futureOwnerWalletAddress);
        if (!result) {
          return res.status(500).json({ error: 'Transfer ownership failed' });
        }

        res.json(result);
      }
      catch (error) {
        console.error('Transfer ownership error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Approval endpoints
    router.post('/approval/create', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, approverAddress, fileName, fileHash, domain } = body;

        if (!clientWalletInfo || !approverAddress || !fileName || !fileHash || !domain) {
          return res.status(400).json({ error: 'Missing required fields: clientWalletInfo, approverAddress, fileName, fileHash, domain' });
        }

        const result = await Epistery.createApproval(clientWalletInfo, approverAddress, fileName, fileHash, domain);
        if (!result) {
          return res.status(500).json({ error: 'Create approval failed' });
        }

        res.json(result);
      }
      catch (error) {
        console.error('Create approval error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.post('/approval/get', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, approverAddress, requestorAddress } = body;

        if (!clientWalletInfo || !approverAddress || !requestorAddress) {
          return res.status(400).json({ error: 'Missing required fields: clientWalletInfo, approverAddress, requestorAddress' });
        }

        const result = await Epistery.getApprovals(clientWalletInfo, approverAddress, requestorAddress);

        res.json({
          approverAddress: approverAddress,
          requestorAddress: requestorAddress,
          approvals: result,
          count: result.length
        });
      }
      catch (error) {
        console.error('Get approvals error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.post('/approval/get-all', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, approverAddress } = body;

        if (!clientWalletInfo || !approverAddress) {
          return res.status(400).json({ error: 'Missing required fields: clientWalletInfo, approverAddress' });
        }

        const result = await Epistery.getAllApprovalsForApprover(clientWalletInfo, approverAddress);

        res.json({
          approverAddress: approverAddress,
          approvals: result,
          count: result.length
        });
      }
      catch (error) {
        console.error('Get all approvals error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.post('/approval/get-all-requestor', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, requestorAddress } = body;

        if (!clientWalletInfo || !requestorAddress) {
          return res.status(400).json({ error: 'Missing required fields: clientWalletInfo, requestorAddress' });
        }

        const result = await Epistery.getAllApprovalsForRequestor(clientWalletInfo, requestorAddress);

        res.json({
          requestorAddress: requestorAddress,
          approvals: result,
          count: result.length
        });
      }
      catch (error) {
        console.error('Get all approvals for requestor error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.post('/approval/handle', async (req, res) => {
      try {
        const body = req.body;
        const { clientWalletInfo, requestorAddress, fileName, approved } = body;

        if (!clientWalletInfo || !requestorAddress || !fileName || approved === undefined) {
          return res.status(400).json({ error: 'Missing required fields: clientWalletInfo, requestorAddress, fileName, approved' });
        }

        const result = await Epistery.handleApproval(clientWalletInfo, requestorAddress, fileName, approved);
        if (!result) {
          return res.status(500).json({ error: 'Handle approval failed' });
        }

        res.json(result);
      }
      catch (error) {
        console.error('Handle approval error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // ============================================================================
    // CLIENT-SIDE SIGNING ENDPOINTS
    //
    // These endpoints support the new client-side signing flow.
    // They work alongside the old endpoints for backward compatibility.
    // ============================================================================

    // ----- PREPARE ENDPOINTS (Build unsigned transactions) -----

    /**
     * POST /data/prepare-write
     *
     * Prepares an unsigned transaction for writing data.
     * Server handles IPFS upload, gas estimation, and client funding.
     * Returns unsigned transaction for client to sign.
     */
    router.post('/data/prepare-write', async (req, res) => {
      try {
        const { clientAddress, publicKey, data } = req.body;

        if (!clientAddress || !publicKey || !data) {
          return res.status(400).json({
            error: 'Missing required fields: clientAddress, publicKey, data'
          });
        }

        const result = await Epistery.prepareWrite(clientAddress, publicKey, data);
        res.json(result);

      } catch (error) {
        console.error('Prepare write error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /data/prepare-transfer-ownership
     *
     * Prepares an unsigned transaction for transferring ownership.
     */
    router.post('/data/prepare-transfer-ownership', async (req, res) => {
      try {
        const { clientAddress, futureOwnerAddress } = req.body;

        if (!clientAddress || !futureOwnerAddress) {
          return res.status(400).json({
            error: 'Missing required fields: clientAddress, futureOwnerAddress'
          });
        }

        const result = await Epistery.prepareTransferOwnership(clientAddress, futureOwnerAddress);
        res.json(result);

      } catch (error) {
        console.error('Prepare transfer ownership error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /approval/prepare-create
     *
     * Prepares an unsigned transaction for creating an approval request.
     */
    router.post('/approval/prepare-create', async (req, res) => {
      try {
        const { clientAddress, approverAddress, fileName, fileHash, domain } = req.body;

        if (!clientAddress || !approverAddress || !fileName || !fileHash || !domain) {
          return res.status(400).json({
            error: 'Missing required fields: clientAddress, approverAddress, fileName, fileHash, domain'
          });
        }

        const result = await Epistery.prepareCreateApproval(
          clientAddress,
          approverAddress,
          fileName,
          fileHash,
          domain
        );
        res.json(result);

      } catch (error) {
        console.error('Prepare create approval error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /approval/prepare-handle
     *
     * Prepares an unsigned transaction for handling an approval request.
     */
    router.post('/approval/prepare-handle', async (req, res) => {
      try {
        const { approverAddress, requestorAddress, fileName, approved, domain } = req.body;

        if (!approverAddress || !requestorAddress || !fileName || approved === undefined || !domain) {
          return res.status(400).json({
            error: 'Missing required fields: approverAddress, requestorAddress, fileName, approved, domain'
          });
        }

        const result = await Epistery.prepareHandleApproval(
          approverAddress,
          requestorAddress,
          fileName,
          approved,
          domain
        );
        res.json(result);

      } catch (error) {
        console.error('Prepare handle approval error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /identity/prepare-deploy
     *
     * Prepares an unsigned transaction for deploying an IdentityContract.
     * Server handles gas estimation and client funding.
     * Returns unsigned deployment transaction for client to sign.
     */
    router.post('/identity/prepare-deploy', async (req, res) => {
      try {
        const { clientAddress, domain } = req.body;

        if (!clientAddress || !domain) {
          return res.status(400).json({
            error: 'Missing required fields: clientAddress, domain'
          });
        }

        const result = await Epistery.prepareDeployIdentityContract(clientAddress, domain);
        res.json(result);

      } catch (error) {
        console.error('Prepare deploy identity contract error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /identity/prepare-add-rivet
     *
     * Prepares an unsigned transaction for adding a rivet to an IdentityContract.
     * Server handles gas estimation and client funding.
     * Returns unsigned transaction for client to sign.
     */
    router.post('/identity/prepare-add-rivet', async (req, res) => {
      try {
        const { signerAddress, contractAddress, rivetAddressToAdd, rivetName, domain } = req.body;

        if (!signerAddress || !contractAddress || !rivetAddressToAdd || !rivetName || !domain) {
          return res.status(400).json({
            error: 'Missing required fields: signerAddress, contractAddress, rivetAddressToAdd, rivetName, domain'
          });
        }

        const result = await Epistery.prepareAddRivetToContract(
          signerAddress,
          contractAddress,
          rivetAddressToAdd,
          rivetName,
          domain
        );
        res.json(result);

      } catch (error) {
        console.error('Prepare add rivet to contract error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // ----- SUBMIT ENDPOINT (Broadcast signed transactions) -----

    /**
     * POST /data/submit-signed
     *
     * Submits a client-signed transaction to the blockchain.
     * This is a generic endpoint used by all write operations.
     *
     * The transaction is already signed and immutable.
     * Server just broadcasts it and returns the receipt.
     */
    router.post('/data/submit-signed', async (req, res) => {
      try {
        const { signedTransaction, operation, metadata } = req.body;

        if (!signedTransaction) {
          return res.status(400).json({
            error: 'Missing required field: signedTransaction'
          });
        }

        const result = await Epistery.submitSignedTransaction(signedTransaction);

        // Merge metadata into response (e.g., ipfsHash for write operations)
        res.json({
          ...result,
          operation: operation,
          metadata: metadata
        });

      } catch (error) {
        console.error('Submit signed transaction error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Domain initialization endpoint - use to set up domain with custom provider
    router.post('/domain/initialize', async (req, res) => {
      try {
        const body = req.body;
        const domain = req.hostname;
        const { provider } = body;

        console.log(`[debug] Domain initialization request for: ${domain}`);
        console.log(`[debug] Provider payload:`, JSON.stringify(provider, null, 2));
        console.log(`[debug] Full request body:`, JSON.stringify(body, null, 2));

        if (!provider || !provider.name || !provider.chainId || !provider.rpc) {
          return res.status(400).json({ error: 'Invalid provider configuration' });
        }

        // Check if domain already exists
        const config = Utils.GetConfig();
        config.setPath(domain);

        let domainConfig = config.data;
        if (!domainConfig.domain) domainConfig.domain = domain;
        domainConfig.pending = true;
        if (!domainConfig.provider) domainConfig.provider = {
          chainId: provider.chainId,
          name: provider.name,
          rpc: provider.rpc
        }

        // Save domain config with custom provider (marked as pending)
        config.save();

        res.json({ status: 'success', message: 'Domain initialized with custom provider' });

      } catch (error) {
        console.error('Domain initialization error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // ============================================================================
    // NOTABOT SCORE ENDPOINTS
    //
    // Funding economics: Server funds legitimate rivets once per hour to enable
    // notabot score commits. Bot farms must either pay their own gas (expensive
    // at scale) or wait real time (defeating purpose).
    // ============================================================================

    // Funding tracking for notabot commits
    const notabotFunding = {
      // rivetAddress => { lastFunded: timestamp, fundingCount: number, firstFunded: timestamp }
      ledger: new Map(),

      // Configuration
      FUNDING_COOLDOWN: 60 * 60 * 1000,  // 1 hour
      MAX_FUNDINGS_PER_DAY: 30,           // Catch runaway scripts
      FUNDING_AMOUNT: '20000000000000000', // 0.02 native token (enough for ~2-3 commits on Polygon)

      getLastFundingTime(rivetAddress) {
        const entry = this.ledger.get(rivetAddress);
        return entry ? entry.lastFunded : 0;
      },

      recordFunding(rivetAddress) {
        const now = Date.now();
        const entry = this.ledger.get(rivetAddress);

        if (!entry) {
          this.ledger.set(rivetAddress, {
            lastFunded: now,
            fundingCount: 1,
            firstFunded: now
          });
        } else {
          entry.lastFunded = now;
          entry.fundingCount++;
        }
      },

      async fundForSingleCommit(rivetAddress, serverWallet) {
        try {
          // Check if server wallet has sufficient balance
          const balance = await serverWallet.wallet.provider.getBalance(serverWallet.wallet.address);
          const fundingAmount = this.FUNDING_AMOUNT;

          if (balance.lt(fundingAmount)) {
            console.error('[Notabot] Server wallet insufficient balance for funding');
            return { success: false, reason: 'insufficient_server_balance' };
          }

          // Send funding transaction
          const tx = await serverWallet.wallet.sendTransaction({
            to: rivetAddress,
            value: fundingAmount,
            maxFeePerGas: 50000000000, // 50 gwei
            maxPriorityFeePerGas: 30000000000 // 30 gwei
          });

          await tx.wait();

          console.log(`[Notabot] Funded ${rivetAddress} with ${fundingAmount} wei`);
          this.recordFunding(rivetAddress);

          return {
            success: true,
            txHash: tx.hash,
            amount: fundingAmount,
            nextEligible: Date.now() + this.FUNDING_COOLDOWN
          };

        } catch (error) {
          console.error('[Notabot] Funding transaction failed:', error);
          return { success: false, reason: 'tx_failed', error: error.message };
        }
      },

      detectSuspiciousPattern(rivetAddress, eventChain) {
        const entry = this.ledger.get(rivetAddress);

        if (!entry) return { suspicious: false };

        // Check for excessive funding requests
        const daysSinceFirst = (Date.now() - entry.firstFunded) / (1000 * 60 * 60 * 24);
        const fundingsPerDay = daysSinceFirst > 0 ? entry.fundingCount / daysSinceFirst : entry.fundingCount;

        if (fundingsPerDay > this.MAX_FUNDINGS_PER_DAY) {
          return {
            suspicious: true,
            reason: 'excessive_funding_rate',
            details: `${fundingsPerDay.toFixed(1)} fundings/day (max: ${this.MAX_FUNDINGS_PER_DAY})`
          };
        }

        // Check for synthetic event patterns (all events at exactly same interval)
        if (eventChain && eventChain.length > 5) {
          const intervals = [];
          for (let i = 1; i < eventChain.length; i++) {
            intervals.push(eventChain[i].timestamp - eventChain[i-1].timestamp);
          }

          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((sum, interval) => {
            return sum + Math.pow(interval - avgInterval, 2);
          }, 0) / intervals.length;

          const stdDev = Math.sqrt(variance);

          // If standard deviation is very low, timing is too uniform (bot-like)
          if (stdDev < avgInterval * 0.1) {
            return {
              suspicious: true,
              reason: 'uniform_timing',
              details: `Events too evenly spaced (stdDev: ${stdDev.toFixed(0)}ms, avg: ${avgInterval.toFixed(0)}ms)`
            };
          }
        }

        return { suspicious: false };
      }
    };

    // Notabot score endpoint - commit score to identity contract
    router.post('/notabot/commit', async (req, res) => {
      try {
        const { commitment, eventChain, identityContractAddress, requestFunding } = req.body;

        if (!commitment || !eventChain || !identityContractAddress) {
          return res.status(400).json({
            error: 'Missing required fields: commitment, eventChain, identityContractAddress'
          });
        }

        // Get rivet information from session/auth
        // For now, expect rivet info in request body
        const { rivetAddress, rivetMnemonic } = req.body;

        if (!rivetAddress || !rivetMnemonic) {
          return res.status(400).json({
            error: 'Missing rivet authentication: rivetAddress, rivetMnemonic'
          });
        }

        // Check for suspicious patterns BEFORE funding
        const suspiciousCheck = notabotFunding.detectSuspiciousPattern(rivetAddress, eventChain);
        if (suspiciousCheck.suspicious) {
          console.log(`[Notabot] Suspicious pattern detected for ${rivetAddress}: ${suspiciousCheck.reason}`);
          return res.status(403).json({
            error: 'Suspicious activity detected',
            reason: suspiciousCheck.reason,
            details: suspiciousCheck.details,
            message: 'This rivet has been flagged for unusual behavior patterns'
          });
        }

        // Handle funding request
        if (requestFunding) {
          const lastFunded = notabotFunding.getLastFundingTime(rivetAddress);
          const timeSinceLastFunding = Date.now() - lastFunded;

          // Check if funding cooldown has elapsed
          if (timeSinceLastFunding < notabotFunding.FUNDING_COOLDOWN) {
            const waitMinutes = Math.ceil((notabotFunding.FUNDING_COOLDOWN - timeSinceLastFunding) / 60000);
            return res.status(402).json({
              error: 'Funding not available yet',
              reason: 'cooldown_active',
              lastFunded: lastFunded,
              nextEligible: lastFunded + notabotFunding.FUNDING_COOLDOWN,
              waitMinutes: waitMinutes,
              message: `Funding available once per hour. Please wait ${waitMinutes} more minutes.`
            });
          }

          // Fund the rivet
          const serverWallet = this.domain;
          const fundingResult = await notabotFunding.fundForSingleCommit(rivetAddress, serverWallet);

          if (!fundingResult.success) {
            return res.status(503).json({
              error: 'Funding failed',
              reason: fundingResult.reason,
              details: fundingResult.error,
              message: 'Server unable to provide funding. You may need to fund your own transaction.'
            });
          }

          console.log(`[Notabot] Funded ${rivetAddress}, next eligible: ${new Date(fundingResult.nextEligible).toISOString()}`);
        }

        // Commit the score to the identity contract
        const result = await Epistery.commitNotabotScore(
          rivetAddress,
          rivetMnemonic,
          { commitment, eventChain },
          identityContractAddress
        );

        res.json(result);

      } catch (error) {
        console.error('Commit notabot score error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get notabot score for a rivet
    router.get('/notabot/score/:rivetAddress', async (req, res) => {
      try {
        const { rivetAddress } = req.params;
        const { identityContractAddress } = req.query;

        if (!rivetAddress) {
          return res.status(400).json({ error: 'Missing rivet address' });
        }

        const score = await Epistery.getNotabotScore(rivetAddress, identityContractAddress);
        res.json(score);

      } catch (error) {
        console.error('Get notabot score error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Whitelist endpoints
    router.get('/whitelist', async (req, res) => {
      try {
        const whitelist = await this.getWhitelist();
        res.json({
          domain: this.domainName,
          owner: this.domain.wallet.address,
          whitelist: whitelist,
          count: whitelist.length
        });
      }
      catch (error) {
        console.error('Get whitelist error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    router.get('/whitelist/check/:address', async (req, res) => {
      try {
        const { address } = req.params;
        const isWhitelisted = await this.isWhitelisted(address);
        res.json({
          address: address,
          isWhitelisted: isWhitelisted,
          domain: this.domainName
        });
      }
      catch (error) {
        console.error('Check whitelist error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    return router;
  }
}

export { EpisteryAttach as Epistery, Config };
