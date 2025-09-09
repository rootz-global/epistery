import { ethers } from 'ethers';
import { Config } from './Config';
import { DomainConfig, WalletConfig } from './types';

export class Utils {
  private static config: Config;
  private static serverWallet: ethers.HDNodeWallet | null = null;

  public static InitServerWallet(domain: string = 'localhost'): ethers.HDNodeWallet | null {
    try {
      if (!this.config) {
        this.config = new Config();
      }

      let domainConfig = this.config.loadDomain(domain);
      if (!domainConfig || !domainConfig.wallet) {
        console.log(`No wallet found for domain: ${domain}, creating new wallet...`);
        
        const wallet = ethers.Wallet.createRandom();
        
        const walletConfig: WalletConfig = {
          address: wallet.address,
          mnemonic: wallet.mnemonic?.phrase || '',
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          signingKey: wallet.signingKey
        };

        const newDomainConfig: DomainConfig = {
          domain: domain,
          provider: this.config.data.provider,
          wallet: walletConfig
        };

        this.config.saveDomain(domain, newDomainConfig);
        domainConfig = newDomainConfig;
        
        console.log(`Created new wallet for domain: ${domain}`);
        console.log(`Wallet address: ${wallet.address}`);
      }

      if (domainConfig.wallet) {
        const provider = new ethers.JsonRpcProvider(domainConfig.provider?.rpc || this.config.data.provider.rpc);
        this.serverWallet = ethers.Wallet.fromPhrase(domainConfig.wallet.mnemonic).connect(provider);
        
        console.log(`Server wallet initialized for domain: ${domain}`);
        console.log(`Wallet address: ${domainConfig.wallet.address}`);
        console.log(`Provider: ${domainConfig.provider?.name || this.config.data.provider.name}`);
        
        return this.serverWallet;
      }

      return null;
    } catch (error) {
      console.error('Error initializing server wallet:', error);
      return null;
    }
  }

  public static GetServerWallet(): ethers.HDNodeWallet | null {
    return this.serverWallet;
  }

  public static GetConfig(): Config {
    if (!this.config) {
      this.config = new Config();
    }
    return this.config;
  }

  public static GetDomainInfo(domain: string = 'localhost'): DomainConfig | null {
    if (!this.config) {
      this.config = new Config();
    }
    
    const domainConfig = this.config.loadDomain(domain);
    return domainConfig || null;
  }
}
