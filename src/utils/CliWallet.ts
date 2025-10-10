import { ethers, Wallet } from 'ethers';
import { Config } from './Config';
import { DomainConfig } from './types';
import fs from 'fs';
import { join } from 'path';

/**
 * CliWallet - Manages wallet operations for CLI/bot contexts
 *
 * Uses Epistery's domain configuration system:
 * - Domain configs stored in ~/.epistery/{domain}/config.ini
 * - Each domain has its own wallet (like server-side)
 * - Default domain configurable in ~/.epistery/config.ini [cli] section
 * - Automatic wallet creation on initialize
 *
 * This matches the server-side model where each domain has a wallet,
 * making CLI usage consistent with server architecture.
 */

export interface KeyExchangeRequest {
  clientAddress: string;
  clientPublicKey: string;
  challenge: string;
  message: string;
  signature: string;
  walletSource: string;
}

export interface KeyExchangeResponse {
  serverAddress: string;
  serverPublicKey: string;
  services: string[];
  challenge: string;
  signature: string;
  identified: boolean;
  authenticated?: boolean;
  profile?: any;
}

export interface SessionInfo {
  domain: string;
  cookie: string;
  authenticated: boolean;
  timestamp: string;
}

export class CliWallet {
  private config: Config;
  private domainName: string;
  private domainConfig: DomainConfig;
  private wallet: Wallet;
  public address: string;
  public publicKey: string;

  private constructor(config: Config, domainName: string, domainConfig: DomainConfig, wallet: Wallet) {
    this.config = config;
    this.domainName = domainName;
    this.domainConfig = domainConfig;
    this.wallet = wallet;
    this.address = wallet.address;
    this.publicKey = wallet.publicKey;
  }

  /**
   * Get the default domain from config.ini [cli] section
   */
  static getDefaultDomain(): string {
    const config = new Config();
    return (config.data as any).cli?.default_domain || 'localhost';
  }

  /**
   * Set the default domain in config.ini [cli] section
   */
  static setDefaultDomain(domain: string): void {
    const config = new Config();
    if (!(config.data as any).cli) {
      (config.data as any).cli = {};
    }
    (config.data as any).cli.default_domain = domain;
    config.save();
  }

  /**
   * Initialize a new domain with wallet
   * Creates ~/.epistery/{domain}/config.ini with new wallet
   */
  static initialize(domain: string, provider?: { name: string, chainId: number, rpc: string }): CliWallet {
    const config = new Config();

    // Check if domain already exists
    let domainConfig = config.loadDomain(domain);
    if (domainConfig && domainConfig.wallet) {
      throw new Error(`Domain '${domain}' already initialized. Use load() to access it.`);
    }

    // Create new wallet
    const ethersWallet = ethers.Wallet.createRandom();

    // Get provider from argument, default config, or use default
    const providerConfig = provider || (config.data as any).default?.provider || {
      chainId: 420420422,
      name: 'polkadot-hub-testnet',
      rpc: 'https://testnet-passet-hub-eth-rpc.polkadot.io'
    };

    // Create domain config
    domainConfig = {
      domain: domain,
      wallet: {
        address: ethersWallet.address,
        mnemonic: ethersWallet.mnemonic?.phrase || '',
        publicKey: ethersWallet.publicKey,
        privateKey: ethersWallet.privateKey
      },
      provider: providerConfig
    };

    // Save domain config
    config.saveDomain(domain, domainConfig);

    console.log(`Initialized domain: ${domain}`);
    console.log(`Address: ${ethersWallet.address}`);
    console.log(`Provider: ${providerConfig.name}`);

    return new CliWallet(config, domain, domainConfig, ethersWallet);
  }

  /**
   * Load domain wallet from config
   * Throws if domain doesn't exist - use initialize() first
   */
  static load(domain?: string): CliWallet {
    const config = new Config();
    const domainName = domain || CliWallet.getDefaultDomain();

    const domainConfig = config.loadDomain(domainName);
    if (!domainConfig || !domainConfig.wallet) {
      throw new Error(
        `Domain '${domainName}' not found or has no wallet. ` +
        `Initialize with: epistery initialize ${domainName}`
      );
    }

    // Reconstruct wallet from config
    let ethersWallet: Wallet;
    if (domainConfig.wallet.mnemonic) {
      ethersWallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic);
    } else if (domainConfig.wallet.privateKey) {
      ethersWallet = new ethers.Wallet(domainConfig.wallet.privateKey);
    } else {
      throw new Error(`Domain '${domainName}' wallet has no mnemonic or privateKey`);
    }

    return new CliWallet(config, domainName, domainConfig, ethersWallet);
  }

  /**
   * Get domain name
   */
  getDomain(): string {
    return this.domainName;
  }

  /**
   * Get provider info
   */
  getProvider() {
    return this.domainConfig.provider;
  }

  /**
   * Sign a message
   */
  async sign(message: string): Promise<string> {
    return await this.wallet.signMessage(message);
  }

  /**
   * Perform key exchange with an Epistery server
   * Automatically saves session cookie to domain config
   */
  async performKeyExchange(serverUrl: string): Promise<KeyExchangeResponse> {
    // Ensure server URL is properly formatted
    const baseUrl = serverUrl.replace(/\/$/, '');
    const connectUrl = `${baseUrl}/.well-known/epistery/connect`;

    // Generate challenge for key exchange
    const challenge = ethers.utils.hexlify(ethers.utils.randomBytes(32));
    const message = `Epistery Key Exchange - ${this.address} - ${challenge}`;

    // Sign the message
    const signature = await this.sign(message);

    // Prepare key exchange request
    const requestData: KeyExchangeRequest = {
      clientAddress: this.address,
      clientPublicKey: this.publicKey,
      challenge: challenge,
      message: message,
      signature: signature,
      walletSource: 'server'
    };

    // Perform key exchange
    const response = await fetch(connectUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Key exchange failed: ${response.status} - ${errorText}`);
    }

    const serverResponse = await response.json() as KeyExchangeResponse;

    // Verify server's identity
    const expectedMessage = `Epistery Server Response - ${serverResponse.serverAddress} - ${serverResponse.challenge}`;
    const recoveredAddress = ethers.utils.verifyMessage(expectedMessage, serverResponse.signature);

    if (recoveredAddress.toLowerCase() !== serverResponse.serverAddress.toLowerCase()) {
      throw new Error('Server identity verification failed');
    }

    // Extract and save session cookie if present
    const cookies = response.headers.get('set-cookie');
    if (cookies) {
      const sessionMatch = cookies.match(/_rhonda_session=([^;]+)/);
      if (sessionMatch) {
        const sessionToken = sessionMatch[1];

        // Save session to domain config
        this.saveSession({
          domain: serverUrl,
          cookie: sessionToken,
          authenticated: serverResponse.authenticated || false,
          timestamp: new Date().toISOString()
        });
      }
    }

    return serverResponse;
  }

  /**
   * Get saved session for this domain
   */
  getSession(): SessionInfo | null {
    const sessionFile = join(this.config.configDir, this.domainName, 'session.json');
    if (!fs.existsSync(sessionFile)) {
      return null;
    }

    try {
      const data = fs.readFileSync(sessionFile, 'utf8');
      return JSON.parse(data) as SessionInfo;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save session info to domain directory
   */
  private saveSession(session: SessionInfo): void {
    const sessionFile = join(this.config.configDir, this.domainName, 'session.json');
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), { mode: 0o600 });
  }

  /**
   * Clear saved session
   */
  clearSession(): void {
    const sessionFile = join(this.config.configDir, this.domainName, 'session.json');
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  }

  /**
   * Create bot authentication header
   * Format: Authorization: Bot <base64-json>
   */
  async createBotAuthHeader(): Promise<string> {
    const message = `Rhonda Bot Authentication - ${new Date().toISOString()}`;
    const signature = await this.sign(message);

    const payload = {
      address: this.address,
      signature,
      message
    };

    return `Bot ${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
  }

  /**
   * Export wallet data (for migration or backup)
   */
  toJSON() {
    return {
      domain: this.domainName,
      address: this.wallet.address,
      publicKey: this.wallet.publicKey,
      provider: this.domainConfig.provider
    };
  }
}