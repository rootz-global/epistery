# Epistery Test Site

This directory contains a demonstration of how external websites can integrate Epistery functionality using simple script tags.

## How it works

1. The main Epistery server runs on port 3000 and provides the `/.epistery` routes
2. This test server runs on port 3001 and simulates an external website
3. The test server proxies `/.epistery` requests to the main server
4. The HTML pages use ES6 modules to import the Epistery client library

## Running the test

1. Start the main Epistery server:
   ```bash
   cd ..
   npm run dev
   ```

2. In a new terminal, start the test server:
   ```bash
   cd test
   npm install
   npm start
   ```

3. Open your browser to:
   - http://localhost:3001 - Main test page
   - http://localhost:3001/about - About page with automatic event logging

## What this demonstrates

- **Easy Integration**: External websites can add Epistery by simply including script tags
- **Automatic Routes**: The `/.epistery` routes are automatically available
- **Client Wallet**: Each visitor gets a local wallet for signing data
- **Data Writing**: Events can be written to IPFS with cryptographic signatures
- **Cross-page Tracking**: Epistery works across different pages of a website

## Real-world Usage

In a real application, instead of proxying requests, you would:

1. Import the Epistery library in your Express.js app
2. Call `epistery.attach(app)` to mount the routes
3. Include the client script tags in your HTML templates

Example:
```javascript
import express from 'express';
import { Epistery } from 'epistery';

const app = express();
const epistery = await Epistery.connect();
await epistery.attach(app);

// Your existing routes...
app.get('/', (req, res) => {
  res.send(`
    <script type="module">
      import Witness from '/.epistery/lib/witness.js';
      const witness = await Witness.connect();
      // Now you can use Epistery functionality
    </script>
  `);
});
```