import fs from 'fs';
import { resolve, join } from 'path';
import ini from 'ini';
import { RootConfig, DomainConfig } from './types';

export class Config {
  public rootName: string;
  public readonly homeDir: string;
  public readonly configDir: string;
  public readonly configFile: string;
  public data!: RootConfig;
  public domains: Record<string, DomainConfig> = {};
  private _activeDomain: string = "";

  constructor() {
    this.rootName = 'epistery';
    this.homeDir = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || '';
    this.configDir = join(this.homeDir, '.' + this.rootName);
    this.configFile = join(this.configDir, 'config.ini');

    if (!fs.existsSync(this.configFile)) {
      this.initialize();
    } else {
      this.load();
    }
  }

  private initialize(): void {
    //TODO: These defaults should be returned to the default.ini used to mint .epistery/config.ini, then customized in config.ini
    const chainId: number | undefined = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : undefined;
    const chainName:string = (process.env.CHAIN_NAME) as string;
    const chainRpcUrl:string = (process.env.CHAIN_RPC_URL) as string;
    const defaultConfig: RootConfig = {
      provider: {
        chainId: chainId,
        name: chainName,
        rpc: chainRpcUrl,
      }
    };

    this.data = defaultConfig;

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    this.save();
  }

  public get activeDomain() {
    return this.domains[this._activeDomain];
  }

  public loadDomain(domain: string): DomainConfig | null {
    try {
      this._activeDomain = domain;
      if (this.domains[domain]) return this.domains[domain];

      const domainConfigDir = join(this.configDir, domain);
      const domainConfigFile = join(domainConfigDir, 'config.ini');

      if (!fs.existsSync(domainConfigFile)) {
        return null;
      }

      const fileData = fs.readFileSync(domainConfigFile);
      this.domains[domain] = ini.decode(fileData.toString()) as DomainConfig;
      return this.domains[domain];
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  public saveDomain(domain: string, domainConfig: DomainConfig): void {
    const domainConfigDir = join(this.configDir, domain);
    const domainConfigFile = join(domainConfigDir, 'config.ini');

    if (!fs.existsSync(domainConfigDir)) {
      fs.mkdirSync(domainConfigDir, { recursive: true });
    }

    this.domains[domain] = domainConfig;
    const text = ini.stringify(domainConfig as any);
    fs.writeFileSync(domainConfigFile, text);
  }

  private load(): void {
    const fileData = fs.readFileSync(this.configFile);
    this.data = ini.decode(fileData.toString()) as RootConfig;
  }

  public save(): void {
    const text = ini.stringify(this.data as any, {});
    fs.writeFileSync(this.configFile, text);
  }
}
