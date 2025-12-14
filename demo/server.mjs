import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
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
  app.use(cookieParser());

  // attach Epistery directly to app
  const epistery = await Epistery.connect();
  await epistery.attach(app);

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.get('/test-key-exchange', (req, res) => {
    res.sendFile(path.join(__dirname, '../test-key-exchange.html'));
  });

  // Whitelist test page
  app.get('/test-whitelist', (req, res) => {
    res.sendFile(path.join(__dirname, 'whitelist-test.html'));
  });

  // Test route using the new named list API for authorization
  app.get('/admin', async (req, res) => {
    try {
      const clientAddress = req.query.address;
      const listName = req.query.list || `${req.hostname}::admin`;

      if (!clientAddress) {
        return res.status(400).send('Address parameter required for demo');
      }

      const isListed = await epistery.isListed(clientAddress, listName);
      if (!isListed) {
        return res.status(403).send(`
          <h1>Access Denied</h1>
          <p>Address ${clientAddress} is not on the "${listName}" list.</p>
          <p><a href="/">Go back</a></p>
        `);
      }

      res.send(`
        <h1>Admin Panel</h1>
        <p>Welcome! Your address ${clientAddress} is on the "${listName}" list.</p>
        <p><a href="/">Go back</a></p>
      `);
    }
    catch (error) {
      console.error('Error checking list:', error);
      res.status(500).send('Error checking authorization');
    }
  });

  // Get all lists for the domain
  app.get('/lists-info', async (req, res) => {
    try {
      const lists = await epistery.getLists();
      res.json({
        message: 'All lists for this domain',
        domain: epistery.domainName,
        count: lists.length,
        lists: lists
      });
    }
    catch (error) {
      console.error('Error getting lists:', error);
      res.status(500).send('Error getting lists');
    }
  });

  // Get a specific list by name
  app.get('/list-info', async (req, res) => {
    try {
      const listName = req.query.list;
      if (!listName) {
        return res.status(400).json({ error: 'List name required (use ?list=name)' });
      }

      const list = await epistery.getList(listName);
      res.json({
        message: `Members of list: ${listName}`,
        listName: listName,
        count: list.length,
        members: list
      });
    }
    catch (error) {
      console.error('Error getting list:', error);
      res.status(500).send('Error getting list');
    }
  });

  const PORT = process.env.TEST_PORT || 3001;

  app.listen(PORT, () => {
    console.log(`\n=== Epistery Test Server ===`);
    console.log(`Test site: http://localhost:${PORT}`);
    console.log(`Status: http://localhost:${PORT}/.well-known/epistery/status`);
    console.log(`\n--- Whitelist Routes ---`);
    console.log(`Whitelist Admin: http://localhost:${PORT}/.well-known/epistery/whitelist/admin`);
    console.log(`Whitelist Check: http://localhost:${PORT}/.well-known/epistery/whitelist/check`);
    console.log(`Whitelist Status: http://localhost:${PORT}/.well-known/epistery/whitelist/status`);
    console.log(`Whitelist Test Page: http://localhost:${PORT}/test-whitelist`);
    console.log(`\n--- List API Routes ---`);
    console.log(`All Lists: http://localhost:${PORT}/lists-info`);
    console.log(`Specific List: http://localhost:${PORT}/list-info?list=epistery::admin`);
    console.log(`\n`);
  });
}

main().catch(err => {
  console.error('Test server failed to start:', err);
  process.exit(1);
});
