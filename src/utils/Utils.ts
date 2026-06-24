import { ethers } from 'ethers';
import { Config } from './Config';
import { DomainConfig } from './types';
import { chainFor } from '../chains';

export class Utils {
  private static config: Config;
  private static serverWallet: ethers.Wallet| null = null;
  // Per-domain wallet cache. Without this, every InitServerWallet() call
  // rebuilds the wallet AND mutates Utils.config via setPath(domain) — racing
  // across concurrent requests for different domains on a multi-tenant host.
  private static walletCache: Map<string, ethers.Wallet> = new Map();

  public static async InitServerWallet(domain: string = 'localhost'): Promise<ethers.Wallet | null> {
    // Fast path: return cached wallet for this domain. Avoids both the
    // wallet-rebuild cost and the static config setPath mutation.
    const cached = this.walletCache.get(domain);
    if (cached) {
      this.serverWallet = cached;
      return cached;
    }
    try {
      if (!this.config) {
        this.config = new Config();
      }

      // Load domain config
      await this.config.setPath(domain);

      const domainConfig = this.config.data.domain ? this.config.data : {domain: domain};

      // Get default provider if not set.
      //
      // epistery-host (multi-domain) keeps the shared default at
      // root [default.provider]; hosted domains may override it.
      // Single-domain consumers (epistery/app, /chat, /scan) put their
      // provider at the root [provider] section — there is no
      // "default" because there's only one domain. Fall back through
      // both so we never leave domainConfig.provider as a JS undefined
      // (which Config.save would persist as the literal text
      // "provider=undefined", and which on reload becomes a truthy
      // string that bypasses the `||` fallback below at chainFor).
      if (!domainConfig.provider) {
        await this.config.setPath('/');
        domainConfig.provider =
          this.config.data.default?.provider ?? this.config.data.provider;
        await this.config.setPath(domain); // Switch back to domain
      }

      if (!domainConfig.wallet) {
        console.log(`No wallet found for domain: ${domain}, creating new wallet...`);

        const wallet = ethers.Wallet.createRandom();

        domainConfig.wallet = {
          address: wallet.address,
          mnemonic: wallet.mnemonic?.phrase || '',
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
        };

        // Strip any keys still undefined before persist — Config.save()
        // serializes undefined as the literal string "undefined", which
        // becomes truthy on reload and trips downstream consumers (the
        // chainFor throw we chased). Belt-and-suspenders against any
        // other field that could be undefined here in the future.
        for (const k of Object.keys(domainConfig) as Array<keyof typeof domainConfig>) {
          if (domainConfig[k] === undefined) delete domainConfig[k];
        }

        this.config.data = domainConfig;
        await this.config.save();

        console.log(`[debug] Created new wallet for domain: ${domain}`);
        console.log(`[debug] Wallet address: ${wallet.address}`);
      }

      if (domainConfig.wallet) {
        const chain = chainFor(domainConfig.provider || { chainId: 137, name: 'Polygon Mainnet', rpc: 'https://polygon-rpc.com' });
        this.serverWallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic).connect(chain.provider);
        this.walletCache.set(domain, this.serverWallet);

        console.log(`Server wallet initialized for domain: ${domain}`);
        console.log(`Wallet address: ${domainConfig.wallet.address}`);
        console.log(`Provider: ${domainConfig.provider?.name}`);

        return this.serverWallet;
      }

      return null;
    } catch (error) {
      console.error('Error initializing server wallet:', error);
      return null;
    }
  }

  public static GetServerWallet(): ethers.Wallet | null {
    return this.serverWallet;
  }

  /**
   * Synchronous accessor for a domain's already-initialized wallet, read from
   * the per-domain cache. Returns null if InitServerWallet(domain) has not been
   * awaited yet. This lets the synchronous `get signer()` getter survive the
   * async migration: setDomain() awaits InitServerWallet to warm the cache, and
   * the getter reads it here without re-entering async config IO.
   */
  public static GetServerWalletFor(domain: string): ethers.Wallet | null {
    return this.walletCache.get(domain) || null;
  }

  public static GetConfig(): Config {
    if (!this.config) {
      this.config = new Config();
    }
    return this.config;
  }

  public static async GetDomainInfo(domain: string = 'localhost'): Promise<DomainConfig> {
    if (!this.config) {
      this.config = new Config();
    }

    await this.config.setPath(`/${domain}`);

    if (!this.config.data.domain)
      return {domain:domain};

    const domainConfig = this.config.data;

    // Provider falls back to root config, same as InitServerWallet. Single-
    // domain apps (App, Relay, Scan) declare their provider once at root
    // [provider] and share it; epistery-host keeps a shared default at
    // [default.provider] that hosted domains may override. Without this,
    // epistery.domain.provider is undefined for those apps and callers that
    // read epistery.domain.provider.rpc (e.g. connect's on-chain contract
    // verification) get no RPC. read('/') doesn't move the current path.
    if (!domainConfig.provider) {
      const rootData = await this.config.read('/');
      domainConfig.provider = rootData.default?.provider ?? rootData.provider;
    }

    return domainConfig;
  }

}
