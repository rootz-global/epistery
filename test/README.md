# Epistery Test Site

This directory contains a demonstration of how external websites can integrate Epistery functionality using simple <script> tags.

## How it works

1. This test server runs on port 3001 and demonstrates a self-contained Epistery integration
2. The Epistery functionality is built directly into this Express.js app using `epistery.attach(app)`
3. No external server or proxying required - all `/.epistery` routes are served directly
4. The HTML pages use ES6 modules to import the Epistery client library from the integrated routes

## Running the test

1. Start the Test App:
   ```bash
   npm start
   ```

2. Open your browser to:
   - http://localhost:3001 - Main (mock) test page
   - http://localhost:3001/.epistery/status - Epistery Status page

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
