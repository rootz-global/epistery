import fs from 'fs';
import { join } from 'path';
import ini from 'ini';

/**
 * Epistery Config - Path-based configuration system
 *
 * Provides unified, filesystem-like config management:
 * - setPath('/') → ~/.epistery/config.ini
 * - setPath('/domain') → ~/.epistery/domain/config.ini
 * - setPath('/.ssl/domain') → ~/.epistery/.ssl/domain/config.ini
 *
 * Usage:
 *   const config = new Config('epistery');
 *   config.setPath('/wiki.rootz.global');
 *   config.load();
 *   config.data.verified = true;
 *   config.save();
 */
export class Config {
  public readonly rootName: string;
  public readonly homeDir: string;
  public readonly configDir: string;

  private currentPath: string = '/';
  private currentDir: string;
  private currentFile: string;

  public data: any = {};

  constructor(rootName: string = 'epistery') {
    this.rootName = rootName;
    this.homeDir = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || '';
    this.configDir = join(this.homeDir, '.' + this.rootName);

    this.currentDir = this.configDir;
    this.currentFile = join(this.configDir, 'config.ini');

    // Initialize root config if it doesn't exist
    if (!fs.existsSync(this.currentFile)) {
      this.initialize();
    }
  }

  /**
   * Set current working path and load config (like cd)
   * Examples: '/', 'domain', '/domain', '/.ssl/domain'
   * Leading slash is optional and will be added if not present
   * Automatically loads the config at the specified path
   */
  public setPath(path: string): void {
    // Normalize path: ensure leading slash, remove trailing slash, lowercase
    path = path.trim();
    if (!path.startsWith('/')) path = '/' + path;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    path = path.toLowerCase();

    this.currentPath = path;

    // Calculate directory and file paths
    if (path === '/') {
      this.currentDir = this.configDir;
      this.currentFile = join(this.configDir, 'config.ini');
    } else {
      this.currentDir = join(this.configDir, path.slice(1)); // Remove leading /
      this.currentFile = join(this.currentDir, 'config.ini');
    }

    // Automatically load the config at this path
    this.load();
  }

  /**
   * Get current path
   */
  public getPath(): string {
    return this.currentPath;
  }

  /**
   * Initialize config at current path
   */
  private initialize(): void {
    if (!fs.existsSync(this.currentDir)) {
      fs.mkdirSync(this.currentDir, { recursive: true });
    }

    // Write default config for root, empty for paths
    const defaultContent = this.currentPath === '/' ? defaultIni : '';
    fs.writeFileSync(this.currentFile, defaultContent);
    this.data = ini.decode(defaultContent);
  }

  /**
   * Load config from current path
   */
  public load(): void {
    if (!fs.existsSync(this.currentFile)) {
      this.data = {};
      return;
    }

    const fileData = fs.readFileSync(this.currentFile, 'utf8');
    this.data = ini.decode(fileData);
  }

  /**
   * Read config from arbitrary path without changing current path
   * @param path Path to read from (e.g., '/', '/domain')
   * @returns Parsed config data from that path
   */
  public read(path: string): any {
    // Normalize path
    path = path.trim();
    if (!path.startsWith('/')) path = '/' + path;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    path = path.toLowerCase();

    // Calculate file location
    let configFile: string;
    if (path === '/') {
      configFile = join(this.configDir, 'config.ini');
    } else {
      configFile = join(this.configDir, path.slice(1), 'config.ini');
    }

    // Read and parse
    if (!fs.existsSync(configFile)) {
      return {};
    }

    const fileData = fs.readFileSync(configFile, 'utf8');
    return ini.decode(fileData);
  }

  /**
   * Save config to current path
   */
  public save(): void {
    if (!fs.existsSync(this.currentDir)) {
      fs.mkdirSync(this.currentDir, { recursive: true });
    }

    const text = ini.stringify(this.data);
    fs.writeFileSync(this.currentFile, text);
  }

  /**
   * Read file from current path directory
   */
  public readFile(filename: string): Buffer {
    return fs.readFileSync(join(this.currentDir, filename));
  }

  /**
   * Write file to current path directory
   */
  public writeFile(filename: string, data: string | Buffer): void {
    if (!fs.existsSync(this.currentDir)) {
      fs.mkdirSync(this.currentDir, { recursive: true });
    }
    fs.writeFileSync(join(this.currentDir, filename), data);
  }

  /**
   * Check if config exists at current path
   */
  public exists(): boolean {
    return fs.existsSync(this.currentFile);
  }

  /**
   * List all subdirectories at current path
   */
  public listPaths(): string[] {
    if (!fs.existsSync(this.currentDir)) {
      return [];
    }

    return fs.readdirSync(this.currentDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  }
}

const defaultIni =
`[profile]
name=
email=

[ipfs]
url=https://rootz.digital/api/v0

[default.provider]
chainId=1
name=Ethereum Mainnet
rpc=https://eth.llamarpc.com
nativeCurrencyName=Ether
nativeCurrencySymbol=ETH
nativeCurrencyDecimals=18

; Additional supported chains:
; Polygon Mainnet (POL):
;   chainId=137
;   name=Polygon Mainnet
;   rpc=https://polygon-rpc.com
;   nativeCurrencyName=POL
;   nativeCurrencySymbol=POL
;   nativeCurrencyDecimals=18
;
; Japan Open Chain (JOC):
;   chainId=81
;   name=Japan Open Chain
;   rpc=https://rpc-2.japanopenchain.org:8545
;   nativeCurrencyName=Japan Open Chain Token
;   nativeCurrencySymbol=JOC
;   nativeCurrencyDecimals=18
`