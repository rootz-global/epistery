/**
 * Domain Certification is a variation of certbot. It uses the Acme client to generate
 * ssl certificates through Let's Encrypt.
 */
import express from 'express';
import acme from 'acme-client';
import tls from 'tls';
import Config from '../../utils/Config.mjs';

export default class DomainRegistry {
  constructor() {
    this.pending = {};
    this.challenges = {};
  }

  static commandLine() {
    const domainRegistry = new DomainRegistry();
    return {
      getcert: domainRegistry.getCert.bind(domainRegistry)
    }
  }

  static async mint(connector) {
    const instance = new DomainRegistry(connector);
    await instance.initialize();
    return instance;
  }
  async initialize() {
    if (!this.acme) {
      this.acme = new acme.Client({
        directoryUrl: acme.directory.letsencrypt[process.env.PROFILE === 'DEV' ? 'staging' : 'production'],
        accountKey: await acme.crypto.createPrivateKey(),
      });
    }
  }

  get SNI() {
    return {
      SNICallback: async (hostname, cb) => {
        const site = this.sites[hostname];
        if (site) {
          cb(null, tls.createSecureContext({key: site.key, cert: site.cert}));
        } else {
          cb(new Error(`${hostname} is unknown`));
        }
      }
    }
  }

  routes() {
    let router = express.Router();
    router.get('/_certify', async (req, res) => {
      try {
        let result = await this.collection.find({_id: req.hostname}).toArray();
        if (result.length > 0) {
          res.send('cert already exists');
        } else {
          await this.getCert(req.hostname);
          res.send(`<p>done.</p><p><a href="https://${req.hostname}">https://${req.hostname}</a></p>`);
        }
      } catch (e) {
        res.status(500).send({status: 'error', message: e.message});
      }
    })
    router.get('/.well-known/acme-challenge/:token', (req, res) => {
      const token = req.params.token;
      if (token in this.challenges) {
        res.writeHead(200);
        res.end(this.challenges[token]);
        return;
      }
      res.writeHead(302, {Location: `https://${req.headers.host}${req.url}`});
      res.end();
    });
    router.use((req, res, next) => {
      if (!req.secure && process.env.FORCE_HTTPS.toLowerCase() !== 'false') {
        return res.redirect(`https://${req.hostname}${req.url}`);
      }
      next();
    });
    return router;
  }

  async getCert(servername, attempt = 0) {
    let config = new Config(servername)
    if (config.data) {
      return config.data.ssl.cert;
    }
    if (servername in this.pending) {
      if (attempt >= 10) {
        throw new Error(`Gave up waiting on certificate for ${servername}`);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
      return this.getCert(servername, (attempt + 1));
    }
    if (!this.contactEmail) throw new Error(`cannot request certificate without CONTACT_EMAIL set`);
    // create CSR
    const [key, csr] = await acme.crypto.createCsr({
      altNames: [servername],
    });
    // order certificate
    const cert = await this.acme.auto({
      csr,
      email: config.root.profile.email,
      termsOfServiceAgreed: true,
      challengePriority: ['http-01'],
      challengeCreateFn: (authz, challenge, keyAuthorization) => {
        this.challenges[challenge.token] = keyAuthorization;
      },
      challengeRemoveFn: (authz, challenge) => {
        delete this.challenges[challenge.token];
      },
    });
    // save certificate
    await this.collection.updateOne({_id: servername},
      {$set: {key: key.toString(), cert: cert, _modified: new Date()}, $setOnInsert: {_created: new Date()}},
      {upsert: true});
    delete this.pending[servername];
    await this.loadSites();
  }
}
