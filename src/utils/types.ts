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

  // Notabot score (populated by middleware from identity contract)
  notabotPoints?: number;
  notabotLastUpdate?: number;
  notabotVerified?: boolean;
  notabotEventCount?: number;
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

// ============================================================================
// RIVET ITEM TYPES
// Matches the RivetItem structure in agent.sol
// ============================================================================

/**
 * Visibility enum matching Solidity enum
 */
export enum Visibility {
  Public = 0,
  Private = 1,
}

/**
 * RivetItem - core data structure for messages and posts
 * Matches the struct in agent.sol
 */
export interface RivetItem {
  from: string;           // Author/sender address
  to: string;             // Recipient (0x0 for posts, specific address for DMs)
  data: string;           // Metadata or short content
  publicKey: string;      // Public key of the sender
  domain: string;         // Domain context
  ipfsHash: string;       // IPFS hash of full content
  visibility: Visibility; // Public or Private
  timestamp: number;      // Unix timestamp (bigint from contract)
}

/**
 * Request to send a direct message
 */
export interface SendMessageRequest {
  to: string;             // Recipient address
  publicKey: string;      // Sender's public key
  data: string;           // Metadata or short content
  domain: string;         // Domain context
  ipfsHash: string;       // IPFS hash of full message content
}

/**
 * Request to create a post on a board
 */
export interface CreatePostRequest {
  board: string;          // Board address (can be own address or another's)
  publicKey: string;      // Sender's public key
  data: string;           // Metadata or short content
  domain: string;         // Domain context
  ipfsHash: string;       // IPFS hash of full post content
  visibility: Visibility; // Public or Private
}

/**
 * Request to get conversation messages
 */
export interface GetConversationRequest {
  otherParty: string;     // The other participant in the conversation
}

/**
 * Request to get posts from a board
 */
export interface GetPostsRequest {
  board: string;          // Board address
  offset?: number;        // For pagination
  limit?: number;         // For pagination
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
  operation: 'write' | 'transferOwnership' | 'createApproval' | 'handleApproval' | 'sendMessage' | 'createPost';
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

/**
 * Notabot System Types
 * Based on US Patent 11,120,469 "Browser Proof of Work"
 */

/**
 * Single event in the notabot chain
 */
export interface NotabotEvent {
  timestamp: number;
  entropyScore: number;        // 0.0 - 1.0
  eventType: string;            // 'mouse_entropy', 'scroll_pattern', etc.
  previousHash: string;
  hash: string;
  signature: string;            // Signed by rivet private key
}

/**
 * Commitment stored on-chain in identity contract
 */
export interface NotabotCommitment {
  totalPoints: number;
  chainHead: string;            // Hash of most recent event
  eventCount: number;
  lastUpdate: number;           // Timestamp
}

/**
 * Full notabot score with verification data
 */
export interface NotabotScore {
  points: number;
  eventCount: number;
  lastUpdate: number;
  verified: boolean;            // Whether chain has been verified
  commitment?: NotabotCommitment;
  eventChain?: NotabotEvent[];  // Optional full chain for verification
}

/**
 * Request to commit notabot score to chain
 */
export interface NotabotCommitRequest {
  commitment: NotabotCommitment;
  eventChain: NotabotEvent[];   // For server verification
}
