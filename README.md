# Epistery

_Epistemology is the study of knowledge. An Epistery, it follows, is a place share the knowledge of knowledge._

This project is open source middleware that provides websites and browsers a shared neutral space to identify and
verify the origin of data and conduct digital business. It inserts the blockchain as a witness and clerk for the mundane
business of clicking, tipping, stamping and cloaking, currently run by commercial web gatekeepers.

Epistery provides the primitive tools for creating and rendering data-wallets.

* /.epistery - json data presenting the signing identity/wallet of the site
* /.epistery/status - human version of the above, plus overview of the site's activity and interactive features like comments, ratings.
* /.epistery/data/* - data-wallet module api for mint, manipulate, render and delete
* /.well-known - Ephemeral ACME url for authorizing ssl cert assignment.

## Usage
```bash
npm install epistery
npm run initialize mydomain.com
```
Initialize creates a wallet for the domain. The default chain provider is established in `~/.epistery/config.ini`.
The wallet keys are written to `~/.epistery/{domain}/config.ini`.

To acquire an SSL cert for the domain use certify. This call uses ACME like letsencrypt. The keys are stored in
`~/.epistery/{domain}/`. Set profile information such as email and business in the root config.ini. Email is required.
The domain name must resolve to the host server and the epistery module needs to be running to confirm the handshake.
```bash
npm run certify mydomain.com
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
