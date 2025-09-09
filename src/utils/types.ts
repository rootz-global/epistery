export interface ProviderConfig {
  chainId: number | undefined;
  name: string;
  rpc: string;
}

export interface WalletConfig {
  address: string;
  mnemonic: string;
  publicKey: string;
  privateKey: string;
  signingKey: any;
}

export interface DomainConfig {
  domain: string;
  provider?: ProviderConfig;
  wallet?: WalletConfig;
}

export interface RootConfig {
  provider: ProviderConfig;
}
