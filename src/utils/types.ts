import { AquaTree } from "aqua-js-sdk";

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ProviderConfig {
  chainId: number | undefined;
  name: string;
  rpc: string;
  nativeCurrencySymbol?: string;
  nativeCurrencyName?: string;
  nativeCurrencyDecimals?: number;
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
  gateway?: string;
}

export interface RootDefaults {
  provider: ProviderConfig;
}

export interface RootConfig {
  profile?: ProfileConfig;
  ipfs?: IPFSConfig;
  default?: RootDefaults;
}

export interface ClientWalletInfo {
  address: string;
  publicKey: string;

  // Used by legacy (browser) data-wallets -- left in for backward compatibility
  mnemonic?: string;
  privateKey?: string;

  // Used by RivetWallets
  walletType?: 'browser' | 'web3' | 'rivet';

  // (For client-side signed operations) This contains the complete signed transaction
  signedTransaction?: string;
}

export interface EpisteryStatus {
  server: {
    walletAddress: string | undefined;
    publicKey: string | undefined;
    provider: string | undefined;
    chainId: number | undefined;
    rpc: string | undefined;
    nativeCurrency?: NativeCurrency;
  };
  client: {
    walletAddress: string;
    publicKey: string;
  };
  ipfs?: IPFSConfig;
  timestamp: string;
}

export interface HashResult {
  hash: string;
}

export interface EpisteryWrite {
  data: string;
  aquaTree?: AquaTree;
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
  walletSource?: string;
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

/**
 * Unsigned transaction prepared by server for client to sign
 * Used in new client-side signing flow
 *
 * Contains ONLY valid Ethereum transaction fields
 */
export interface UnsignedTransaction {
  // Transaction fields
  to: string;
  data: string;
  value: string;
  nonce: number;
  chainId: number;

  // Gas configuration (EIP-1559 for Polygon, legacy for others)
  gasLimit: string;

  // Legacy gas (Ethereum mainnet, some L2s)
  gasPrice?: string;

  // EIP-1559 gas (Polygon, modern chains)
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

/**
 * Request to prepare an unsigned transaction
 */
export interface PrepareTransactionRequest {
  clientAddress: string;
  publicKey: string;
  operation: 'write' | 'transferOwnership' | 'createApproval' | 'handleApproval';
  params: any;
}

/**
 * Response from transaction preparation
 */
export interface PrepareTransactionResponse {
  unsignedTransaction: UnsignedTransaction;
  ipfsHash?: string;
  metadata?: any;
}

/**
 * Request to submit a signed transaction
 */
export interface SubmitSignedTransactionRequest {
  signedTransaction: string;
  operation: string;
  metadata?: any;
}

/**
 * Response from transaction submission
 */
export interface SubmitSignedTransactionResponse {
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  status: number;  // 1 = success, 0 = reverted
  receipt: any;    // Full ethers receipt object
}
