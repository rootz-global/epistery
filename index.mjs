import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple in-memory storage for demo purposes
const domains = {};
const clients = {};

class EpisteryClient {
  static createWallet() {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      mnemonic: wallet.mnemonic?.phrase || '',
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
    };
  }

  static async writeEvent(clientWalletInfo, data) {
    // Create real wallet from client info
    const clientWallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic);
    
    // Create message hash and sign it
    const dataString = JSON.stringify(data);
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataString));
    const signature = await clientWallet.signMessage(messageHash);

    // Simulate IPFS storage (in real implementation, this would upload to IPFS)
    const mockHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataString + Date.now())).slice(2, 48);
    
    const result = {
      data: data,
      signature: signature,
      messageHash: messageHash,
      client: {
        address: clientWallet.address,
        publicKey: clientWalletInfo.publicKey
      },
      timestamp: new Date().toISOString(),
      signedBy: clientWallet.address,
      ipfsHash: mockHash,
      ipfsUrl: `https://ipfs.io/ipfs/${mockHash}`,
    };

    return result;
  }
}

export default class Epistery {
  constructor(options = {}) {
    this.options = options;
    this.rootDir = path.resolve('.');
    this.domain = null;
  }

  static async connect(options) {
    const epistery = new Epistery(options);
    return epistery;
  }

  async setDomain(domain) {
    if (!domains[domain]) {
      domains[domain] = {
        name: domain,
        wallet: EpisteryClient.createWallet(),
        provider: {
          name: 'local-testnet',
          chainId: 31337,
          rpc: 'http://localhost:8545'
        }
      };
    }
    this.domain = domains[domain];
  }

  async attach(app) {
    app.locals.epistery = this;
    
    // Domain middleware
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

    // API Routes
    router.get('/status', (req, res) => {
      const domain = req.hostname;
      const serverWallet = this.domain;
      
      const status = {
        server: {
          walletAddress: serverWallet?.wallet?.address,
          publicKey: serverWallet?.wallet?.publicKey,
          provider: serverWallet?.provider?.name,
          chainId: serverWallet?.provider?.chainId,
          rpc: serverWallet?.provider?.rpc,
          domain: domain
        },
        client: {},
        timestamp: new Date().toISOString()
      };

      res.json(status);
    });

    router.get('/create', (req, res) => {
      const wallet = EpisteryClient.createWallet();
      res.json({ wallet });
    });

    router.post('/data/write', express.json(), async (req, res) => {
      try {
        const { clientWalletInfo, data } = req.body;
        
        if (!clientWalletInfo || !data) {
          return res.status(400).json({ error: 'Missing clientWalletInfo or data' });
        }

        const result = await EpisteryClient.writeEvent(clientWalletInfo, data);
        res.json(result);
        
      } catch (error) {
        console.error('Write error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // HTML status page
    router.get('/status.html', (req, res) => {
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

    return router;
  }
}