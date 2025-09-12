import * as dotenv from 'dotenv'
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { Utils } from './utils/index.js';
import { CreateController } from './controllers/create/CreateController.js';
import { StatusController } from './controllers/status/StatusController.js';
import { WriteController } from './controllers/write/WriteController.js';
import { SSLController } from './controllers/ssl/SSLController.js';
import { Epistery } from 'epistery';

dotenv.config();
Epistery.initialize();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

// attach to the active domain. The domain is declared by context not by the environment
app.use(async (req, res, next) => {
  if (req.app.locals.episteryConfig?.domain?.name !== req.hostname) {
    req.app.locals.episteryConfig = Utils.GetConfig();
    Utils.InitServerWallet(req.hostname);
    await app.locals.episteryConfig.loadDomain(req.hostname);
  }
  next();
})

const createController = new CreateController();
const statusController = new StatusController();
const writeController = new WriteController();
const sslController = new SSLController();

// Client library routes
const library = {
  "client.js": "client/client.js",
  "witness.js": "client/witness.js",
  "ethers.js": "client/ethers.js",
  "ethers.min.js": "client/ethers.min.js"
};

// Serve client library files
app.get('/.epistery/lib/:module', (req, res) => {
  const modulePath = library[req.params.module as keyof typeof library];
  if (!modulePath) return res.status(404).send('Library not found');

  const fullPath = path.resolve(modulePath);
  if (!fs.existsSync(fullPath)) return res.status(404).send('File not found');

  const ext = fullPath.slice(fullPath.lastIndexOf('.') + 1);
  const contentTypes: { [key: string]: string } = {
    'js': 'text/javascript',
    'mjs': 'text/javascript',
    'css': 'text/css',
    'html': 'text/html',
    'json': 'application/json'
  };

  if (contentTypes[ext]) {
    res.set('Content-Type', contentTypes[ext]);
  }

  res.sendFile(fullPath);
});

// HTML status page
app.get('/.epistery/status.html', (req, res) => {
  const config = Utils.GetConfig();
  const domain = config.activeDomain.domain;
  const serverDomain = Utils.GetDomainInfo(domain);

  if (!serverDomain.wallet) {
    return res.status(500).send('Server wallet not found');
  }

  const status = Epistery.getStatus({} as any, serverDomain);
  const templatePath = path.resolve('client/status.html');

  if (!fs.existsSync(templatePath)) {
    return res.status(404).send('Status template not found');
  }

  let template = fs.readFileSync(templatePath, 'utf8');

  // Simple template replacement
  template = template.replace(/\{\{server\.domain\}\}/g, domain);
  template = template.replace(/\{\{server\.walletAddress\}\}/g, status.server.walletAddress || '');
  template = template.replace(/\{\{server\.provider\}\}/g, status.server.provider || '');
  template = template.replace(/\{\{server\.chainId\}\}/g, status.server.chainId?.toString() || '');
  template = template.replace(/\{\{timestamp\}\}/g, status.timestamp);

  res.send(template);
});

// API routes
app.get('/.epistery/status', statusController.index.bind(statusController));
app.get('/.epistery/create', createController.index.bind(createController));
app.post('/.epistery/data/write', writeController.index.bind(writeController));
app.get('/.well-known/acme-challenge/:token', sslController.index.bind(sslController));

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Available routes:');
  console.log('  GET  /.epistery/status');
  console.log('  GET  /.epistery/status.html');
  console.log('  GET  /.epistery/create');
  console.log('  GET  /.epistery/lib/:module');
  console.log('  POST /.epistery/data/write');
});
