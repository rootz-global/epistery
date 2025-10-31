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

  async attach(app) {
    app.locals.epistery = this;

    app.use(async (req, res, next) => {
      if (req.app.locals.epistery.domain?.name !== req.hostname) {
        await req.app.locals.epistery.setDomain(req.hostname);
      }
      next();
    });

    // Mount routes - RFC 8615 compliant well-known URI
    app.use('/.well-known/epistery', this.routes());
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
      this.domain.wallet.address,
      this.domainName
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
      this.domainName,
      address
    );
  }

  routes() {
    const router = express.Router();

    // Client library files
    const library = {
      "client.js": path.resolve(__dirname, "client/client.js"),
      "witness.js": path.resolve(__dirname, "client/witness.js"),
      "wallet.js": path.resolve(__dirname, "client/wallet.js"),
      "export.js": path.resolve(__dirname, "client/export.js"),
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

    router.get('/status', (req, res) => {
      const domain = req.hostname;
      const serverWallet = this.domain;

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

      res.send(template);
    });

    // Main status endpoint (simplified path)
    router.get('/', (req, res) => {
      const serverWallet = this.domain;

      if (!serverWallet) {
        return res.status(500).json({ error: 'Server wallet not found' });
      }

      const status = Epistery.getStatus({}, serverWallet);
      res.json(status);
    });

    // API routes using the 'src/epistery.ts' defined functions
    router.get('/api/status', (req, res) => {
      const serverWallet = this.domain;

      if (!serverWallet) {
        return res.status(500).json({ error: 'Server wallet not found' });
      }

      const status = Epistery.getStatus({}, serverWallet);
      res.json(status);
    });

    // Key exchange endpoint - handles POST requests for key exchange
    router.post('/connect', express.json(), async (req, res) => {
      try {
        const serverWallet = this.domain;

        if (!serverWallet?.wallet) {
          return res.status(500).json({ error: 'Server wallet not found' });
        }

        // Handle key exchange request
        const keyExchangeResponse = await Epistery.handleKeyExchange(req.body, serverWallet.wallet);

        if (!keyExchangeResponse) {
          return res.status(401).json({ error: 'Key exchange failed - invalid client credentials' });
        }
        const clientInfo = {
          address: req.body.clientAddress,
          publicKey:req.body.clientPublicKey
        }
        if (this.options.authentication) {
          clientInfo.profile = await this.options.authentication.call(this.options.authentication,clientInfo);
          clientInfo.authenticated = !!clientInfo.profile;
          console.log('[epistery] Authentication result:', {
            address: clientInfo.address,
            hasProfile: !!clientInfo.profile,
            authenticated: clientInfo.authenticated,
            hasCallback: !!this.options.onAuthenticated
          });
        }
        req.episteryClient = clientInfo;

        // Call onAuthenticated hook if provided
        if (this.options.onAuthenticated && clientInfo.authenticated) {
          console.log('[epistery] Calling onAuthenticated callback');
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

    router.post('/data/write', express.json(), async (req, res) => {
      try {
        const { clientWalletInfo, data } = req.body;

        if (!clientWalletInfo || !data) {
          return res.status(400).json({ error: 'Missing client wallet or data' });
        }

        // Set the domain for the write operation
        //process.env.SERVER_DOMAIN = req.hostname;

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

    router.post('/data/read', express.json(), async (req, res) => {
      try {
        const { clientWalletInfo } = req.body;

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

    router.put('/data/ownership', express.json(), async (req, res) => {
      try {
        const { clientWalletInfo, futureOwnerWalletAddress } = req.body;

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

    // Domain initialization endpoint - use to set up domain with custom provider
    router.post('/domain/initialize', express.json(), async (req, res) => {
      try {
        const domain = req.hostname;
        const { provider } = req.body;

        console.log(`[debug] Domain initialization request for: ${domain}`);
        console.log(`[debug] Provider payload:`, JSON.stringify(provider, null, 2));
        console.log(`[debug] Full request body:`, JSON.stringify(req.body, null, 2));

        if (!provider || !provider.name || !provider.chainId || !provider.rpc) {
          console.log(`[debug] Validation failed: provider=${!!provider}, name=${!!provider?.name}, chainId=${!!provider?.chainId}, rpc=${!!provider?.rpc}`);
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
        console.log(`Initialized domain ${domain} with provider ${provider.name} (pending)`);

        res.json({ status: 'success', message: 'Domain initialized with custom provider' });

      } catch (error) {
        console.error('Domain initialization error:', error);
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

    // // Status and service projection
    // router.get('/', (req, res) => {
    //
    // })

    return router;
  }
}

export { EpisteryAttach as Epistery, Config };
