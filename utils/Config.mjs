import fs from 'fs';
import {resolve,join} from 'path';
import ini from 'ini';

export default class Config {
  constructor() {
    this.rootName = process.env.ROOT_NAME || 'epistery';
    this.homeDir = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME);
    this.configDir = join(this.homeDir, '.' + this.rootName);
    this.configFile = join(this.configDir, 'config.ini');
    this.domains = {};
    if (!fs.existsSync(this.configFile)) {
      this.initialize();
    } else {
      this.load();
    }
  }

  initialize() {
    let fileData = fs.readFileSync(resolve('./default.ini'), 'utf8');
    this.data = ini.decode(fileData.toString());
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir);
    }
    this.save()
  }
  loadDomain(domain) {
    try {
      if (this.domains[domain]) return this.domains[domain];
      const domainConfigDir = join(this.configDir, domain);
      const domainConfigFile = join(this.configDir, domain, 'config.ini');
      if (!fs.existsSync(domainConfigFile)) {
        const text = ini.stringify(Object.assign({name:domain},this.data.defaultDomainConfig));
        if (!fs.existsSync(domainConfigDir)) {
          fs.mkdirSync(domainConfigDir);
        }
        fs.writeFileSync(domainConfigFile, text);
      }
      const fileData = fs.readFileSync(domainConfigFile);
      this.domains[domain] = ini.decode(fileData.toString());
      return this.domains[domain];
    } catch(e) {
      console.error(e)
      return null;
    }
  }
  saveDomain(domain) {
    const domainConfigDir = join(this.configDir, domain);
    const domainConfigFile = join(this.configDir, domain, 'config.ini');
    if (!fs.existsSync(domainConfigDir)) {
      fs.mkdirSync(domainConfigDir);
    }
    const text = ini.stringify(Object.assign({name:domain},this.domains[domain]));
    fs.writeFileSync(domainConfigFile, text);
  }
  load() {
    let fileData = fs.readFileSync(this.configFile);
    this.data = ini.decode(fileData.toString());
  }

  save() {
    let text = ini.stringify(this.data, {});
    fs.writeFileSync(this.configFile, text);
  }

  writeFile(filename, data) {
    fs.writeFileSync(join(this.domainConfigDir, filename), data);
  }

  readFile(filename) {
    return fs.readFileSync(join(this.domainConfigDir, filename));
  }

  writeRootFile(filename, data) {
    fs.writeFileSync(join(this.configDir, filename), data);
  }

  readRootFile(filename) {
    return fs.readFileSync(join(this.configDir, filename));
  }
}
