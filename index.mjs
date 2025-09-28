import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Epistery } from './dist/epistery.js';
import { Utils } from './dist/utils/Utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to get or create domain configurations src/utils/Config.ts system
function getDomainConfig(domain) {
  let domainConfig = Utils.GetDomainInfo(domain);
  if (!domainConfig.wallet) {
    Utils.InitServerWallet(domain);
    domainConfig = Utils.GetDomainInfo(domain);
  }
  return domainConfig;
}

class EpisteryAttach {
  constructor(options = {}) {
    this.options = options;
    this.domain = null;
  }

  static async connect(options) {
    const attach = new EpisteryAttach(options);
    await Epistery.initialize();
    return attach;
  }

  async setDomain(domain) {
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

    // Mount routes
    app.use('/.epistery', this.routes());
  }

  routes() {
    const router = express.Router();

    // Client library files
    const library = {
      "client.js": path.resolve(__dirname, "client/client.js"),
      "witness.js": path.resolve(__dirname, "client/witness.js"),
      "wallet.js": path.resolve(__dirname, "client/wallet.js"),
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

    // Key exchange endpoint - handles POST requests for FIDO-like key exchange
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
          address:req.body.clientAddress,
          publicKey:req.body.clientPublicKey
        }
        req.app.locals.episteryClient = clientInfo;
        if (this.options.authentication) {
          keyExchangeResponse.profile = await this.options.authentication.call(this.options.authentication,clientInfo);
          keyExchangeResponse.authenticated = !!keyExchangeResponse.profile;
        }

        res.json(keyExchangeResponse);

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
          return res.status(400).json({ error: 'Missing clientWalletInfo or data' });
        }

        // Set the domain for the write operation
        //process.env.SERVER_DOMAIN = req.hostname;

        const result = await Epistery.write(clientWalletInfo, data);
        if (!result) {
          return res.status(500).json({ error: 'Write operation failed' });
        }

        res.json(result);

      } catch (error) {
        console.error('Write error:', error);
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

export { EpisteryAttach as Epistery };
