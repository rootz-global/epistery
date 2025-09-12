import { ethers } from 'ethers';
import { Config } from './Config';
import { DomainConfig, WalletConfig } from './types';

export class Utils {
  private static config: Config;
  private static serverWallet: ethers.Wallet| null = null;

  public static InitServerWallet(domain: string = 'localhost'): ethers.Wallet | null {
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
        const provider = new ethers.providers.JsonRpcProvider(domainConfig.provider?.rpc || this.config.data.provider.rpc);
        this.serverWallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic).connect(provider);
        
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

  public static GetServerWallet(): ethers.Wallet | null {
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
    if (!domainConfig)
      return null;

    return domainConfig;
  }
}
