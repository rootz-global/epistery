import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Epistery } from '../index.mjs';

// Get directory paths for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  const app = express();
  app.use(express.urlencoded({extended: true}));
  app.use(express.json());

  // attach Epistery directly to app
  const epistery = await Epistery.connect();
  await epistery.attach(app);

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.get('/test-key-exchange', (req, res) => {
    res.sendFile(path.join(__dirname, '../test-key-exchange.html'));
  });

  // Test route using whitelist for authorization
  app.get('/admin', async (req, res) => {
    try {
      const clientAddress = req.query.address;

      if (!clientAddress) {
        return res.status(400).send('Address parameter required for demo');
      }

      const isWhitelisted = await epistery.isWhitelisted(clientAddress);
      if (!isWhitelisted) {
        return res.status(403).send(`
          <h1>Access Denied</h1>
          <p>Address ${clientAddress} is not whitelisted for this domain.</p>
          <p><a href="/">Go back</a></p>
        `);
      }

      res.send(`
        <h1>Admin Panel</h1>
        <p>Welcome! Your address ${clientAddress} is whitelisted.</p>
        <p><a href="/">Go back</a></p>
      `);
    }
    catch (error) {
      console.error('Error checking whitelist:', error);
      res.status(500).send('Error checking authorization');
    }
  });

  app.get('/whitelist-info', async (req, res) => {
    try {
      const whitelist = await epistery.getWhitelist();
      res.json({
        message: 'Whitelisted addresses for this domain',
        count: whitelist.length,
        addresses: whitelist
      });
    }
    catch (error) {
      console.error('Error getting whitelist:', error);
      res.status(500).send('Error getting whitelist');
    }
  });

  const PORT = process.env.TEST_PORT || 3001;

  app.listen(PORT, () => {
    console.log(`Test site: http://localhost:${PORT}`);
    console.log(`Status: http://localhost:${PORT}/.epistery/status`);
    console.log(`Whitelist API: http://localhost:${PORT}/.well-known/epistery/whitelist`);
    console.log(`Whitelist Info: http://localhost:${PORT}/whitelist-info`);
  });
}

main().catch(err => {
  console.error('Test server failed to start:', err);
  process.exit(1);
});
