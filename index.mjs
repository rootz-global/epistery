import express from 'express';
import Config from './utils/Config.mjs';
import TemplateText from './utils/TemplateText.mjs';
import fs from "fs";
import {resolve,join} from "path";
import {ethers, JsonRpcProvider} from "ethers";

const library = {
  "client.js": "client/client.js",
  "witness.js": "client/witness.js",
  "ethers.js": "node_modules/ethers/dist/ethers.js",
  "ethers.min.js": "node_modules/ethers/dist/ethers.min.js",
  "ethers.js.map": "node_modules/ethers/dist/ethers.js.map"
}

export default class Epistery {
  constructor(options={}) {
    this.options = options;
    this.rootDir = resolve(".");
    this.config = new Config();
    this.modules = {};
  }

  static async connect(options) {
    try {
      const epistery = new Epistery(options);
      await epistery.loadModules();
      return epistery;
    } catch (e) {
      console.log(e)
    }
  }
  async setDomain(domain) {
    this.domain = await this.config.loadDomain(domain);
    if (this.domain.provider) {
      this.rpc = new JsonRpcProvider(dw.config.data.provider.rpc);
    }
    if (this.config.domain.wallet && this.rpc) {
      this.wallet = ethers.Wallet.fromPhrase(this.config.domain.wallet.mnemonic).connect(this.rpc);
    }

  }

  async attach(app) {
    app.locals.epistery = this;
    app.use(async (req, res, next) => {
      if (req.app.locals.epistery.domain?.name !== req.hostname) {
        const epistery = app.locals.epistery;
        await app.locals.epistery.setDomain(req.hostname);
      }
      next();
    })
    app.use(this.routes());
  }

  async loadModules() {
    let modulesDir = resolve('./modules')
    const modules = fs.readdirSync(modulesDir);
    for (let module of modules) {
      const mod = await import(join(modulesDir, module, 'index.mjs'));
      this.modules[module] = mod.default;
    }
    this.modules = [].map(async (Module) => {
      return {[Module.className]:Module.mint?await Module.mint(this):new Module(this)}
    })
  }

  routes() {
    const router = express.Router();
    const rootPath = `/.${this.config.rootName}`;

    for (const m in this.modules) router.use(rootPath, this.modules[m].routes());
    router.use(rootPath, this.rootServices());
    return router;
  }

  rootServices() {
    let router = express.Router();
    router.get('/', (req, res) => {
      let data = req.app.locals.epistery.domain;
      let body = {domain: data.domain}
      if (data.provider) body.provider = {
        chainId: data.provider.chainId,
        name: data.provider.name,
        rpc: data.provider.rpc
      }
      if (data.wallet) body.wallet = {
        address: data.wallet.address,
        publicKey: data.wallet.publicKey
      }
      res.status(200).json(body);
    })
    router.get('/favicon.ico', (req, res) => {
      res.set('Content-Type','image/png');
      res.sendFile(resolve('favicon.ico'));
    })
    router.get('/status', (req, res) => {
      let data = req.app.locals.epistery.config.data;
      let body = new TemplateText.File(resolve('./client/status.html')).parse(req.app.locals.epistery.domain);
      res.send(body);
    })
    router.get('/lib/:module', (req, res) => {
      let modulePath = library[req.params.module];
      if (!modulePath) return res.status(404).send();
      modulePath = resolve(modulePath);
      let ext = modulePath.slice(modulePath.lastIndexOf('.') + 1);
      let type = {
        css: 'text/css',
        js: 'text/javascript',
        mjs: 'text/javascript',
        html: 'text/html',
        json: 'application/json',
        map: 'application/json'
      }[ext];
      if (type) res.set("Content-Type", type);
      res.sendFile(modulePath);
    })
    return router;
  }
}
