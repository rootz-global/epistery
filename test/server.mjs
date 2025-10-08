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
  
  // attach Epistery directly to app
  const epistery = await Epistery.connect();
  await epistery.attach(app);
  
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.get('/test-key-exchange', (req, res) => {
    res.sendFile(path.join(__dirname, '../test-key-exchange.html'));
  });
  
  const PORT = process.env.TEST_PORT || 3001;
  
  app.listen(PORT, () => {
    console.log(`Test site: http://localhost:${PORT}`);
    console.log(`Status: http://localhost:${PORT}/.well-known/epistery/status`);
  });
}

main().catch(err => {
  console.error('Test server failed to start:', err);
  process.exit(1);
});
