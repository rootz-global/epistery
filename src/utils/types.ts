import { AquaTree } from "aqua-js-sdk";

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
}

export interface DomainConfig {
  domain: string;
  provider?: ProviderConfig;
  wallet?: WalletConfig;
}

export interface ProfileConfig {
    email?: string;
}

export interface IPFSConfig {
  url: string;
}

export interface RootConfig {
  profile?: ProfileConfig;
  ipfs?: IPFSConfig;
  provider: ProviderConfig;
}

export interface ClientWalletInfo {
  address: string;
  mnemonic: string;
  publicKey: string;
  privateKey: string;
}

export interface EpisteryStatus {
  server: {
    walletAddress: string | undefined;
    publicKey: string | undefined;
    provider: string | undefined;
    chainId: number | undefined;
    rpc: string | undefined;
  };
  client: {
    walletAddress: string;
    publicKey: string;
  };
  timestamp: string;
}

export interface HashResult {
  hash: string;
}

export interface EpisteryWrite {
  data: string;
  aquaTree: AquaTree;
  signature: string;
  messageHash: string;
  client: {
    address: string;
    publicKey: string;
  },
  server: {
    address: string | undefined;
    domain: string;
  },
  timestamp: string;
  signedBy: string;
  ipfsHash: string | undefined;
  ipfsUrl: string | undefined;
}

export interface KeyExchangeRequest {
  clientAddress: string;
  clientPublicKey: string;
  challenge: string;
  message: string;
  signature: string;
}

export interface KeyExchangeResponse {
  serverAddress: string;
  serverPublicKey: string;
  services: string[];
  challenge: string;
  signature: string;
  identified: boolean;
  authenticated: boolean;
  profile: object | undefined;
}
