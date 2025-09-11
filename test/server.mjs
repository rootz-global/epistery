import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Epistery from '../index.mjs';

// Get directory paths for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const app = express();
  
  // This is the key part - attach Epistery directly to this app
  const epistery = await Epistery.connect();
  await epistery.attach(app);
  
  // Serve the test HTML page
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });
  
  // Add some other test routes to simulate a real application
  app.get('/about', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>About - Test Site</title>
        <script type="module">
          import Witness from '/.epistery/lib/witness.js';
          (async () => {
            const witness = await Witness.connect();
            await witness.writeEvent({
              event: 'page_visit',
              page: 'about',
              timestamp: new Date().toISOString()
            });
            console.log('Page visit logged to Epistery');
          })();
        </script>
      </head>
      <body>
        <h1>About This Test Site</h1>
        <p>This demonstrates how Epistery can be integrated into any page of a website.</p>
        <p><a href="/">← Back to Home</a></p>
      </body>
      </html>
    `);
  });
  
  const PORT = process.env.TEST_PORT || 3001;
  
  app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 SELF-CONTAINED EPISTERY TEST SERVER');
    console.log('='.repeat(60));
    console.log(`Test site: http://localhost:${PORT}`);
    console.log(`About page: http://localhost:${PORT}/about`);
    console.log(`Status: http://localhost:${PORT}/.epistery/status`);
    console.log(`Status HTML: http://localhost:${PORT}/.epistery/status.html`);
    console.log('');
    console.log('✅ This server now has Epistery built-in!');
    console.log('✅ No external server required');
    console.log('✅ /.epistery routes attached directly to this app');
    console.log('');
    console.log('This demonstrates how any Express.js app can integrate');
    console.log('Epistery with just: import Epistery from "epistery"');
    console.log('='.repeat(60));
  });
}

main().catch(err => {
  console.error('Test server failed to start:', err);
  process.exit(1);
});