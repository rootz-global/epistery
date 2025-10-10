# Epistery

_Epistemology is the study of knowledge. An Epistery, it follows, is a place share the knowledge of knowledge._

This project is open source middleware that provides websites and browsers a shared neutral space to identify and
verify the origin of data and conduct digital business. It inserts the blockchain as a witness and clerk for the mundane
business of clicking, tipping, stamping and cloaking, currently run by commercial web gatekeepers.

Epistery provides the primitive tools for creating and rendering data-wallets.

* /.well-known/epistery - json data presenting the signing identity/wallet of the site
* /.well-known/epistery/status - human version of the above, plus overview of the site's activity and interactive features like comments, ratings.
* /.well-known/epistery/data/* - data-wallet module api for mint, manipulate, render and delete
* /.well-known/acme - Ephemeral ACME url for authorizing ssl cert assignment.

## Usage
>This has to be revisited to document how it is actually used.
```bash
npm install epistery
npm run initialize mydomain.com
```

In the code, access the certs through epistery.config.
```javascript
import Certify from './modules/certify/index.mjs';

const epistery = await Epistery.connect()
await epistery.attach(app);
const app = express();
epistery.setDomain('mydomain.com');
const https_server = https.createServer(certify.SNI,app);
https_server.listen(443);
```

## Data Wallets

A data wallet is data with chain. The data wallet attaches to the source object with a hash and is used to track
the provenance, manipulation and usage of the data, per instruction by the owner. The epistery enables IPFS as a
default storage option for uploaded objects, but there is no requirement to load the data itself on chain, just
its accounting.
