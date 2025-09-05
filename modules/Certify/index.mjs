/**
 * Domain Certification is a variation of certbot. It uses the Acme client to generate
 * ssl certificates through Let's Encrypt.
 */
import express from 'express';
import acme from 'acme-client';
import tls from 'tls';

export default class Certify {
  constructor(epistery) {
    this.epistery = epistery;
    this.pending = {};
    this.challenges = {};
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
        const domain = this.epistery.config.setDomain(hostname);
        if (domain.ssl) {
          cb(null, tls.createSecureContext({key: domain.ssl.key, cert: domain.ssl.cert}));
        } else {
          cb(new Error(`${hostname} is unknown`));
        }
      }
    }
  }

  routes() {
    let router = express.Router();
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
    if (this.epistery.config.domain.ssl) {
      return this.epistery.config.domain.ssl.cert;
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
    await this.initialize();
    await this.epistery.setDomain(servername);
    if (!this.epistery.data.profile.email) throw new Error(`cannot request certificate without "email" set in epistery/config.ini`);
    // create CSR
    const [key, csr] = await acme.crypto.createCsr({
      altNames: [servername],
    });
    // order certificate
    const cert = await this.acme.auto({
      csr,
      email: this.epistery.config.data.profile.email,
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
    this.epistery.config.domain.ssl = {cert:cert,key:key,modified:new Date()};
    this.epistery.config.saveDomain(servername);
    delete this.pending[servername];
  }
}
