import { ethers } from 'ethers';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .test.env BEFORE importing fixtures that depend on env vars
const testEnvPath = path.resolve(__dirname, '..', '.test.env');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath });
}

import { TEST_WALLETS, TEST_PROVIDER, TEST_CONTRACT_ADDRESS, WalletInfo } from './fixtures/wallets';

// Re-export fixtures for convenience
export { TEST_WALLETS, TEST_PROVIDER, TEST_CONTRACT_ADDRESS };

/**
 * Test application wrapper with utility methods
 */
export interface TestApp {
  app: Express;
  epistery: any;
  supertest: ReturnType<typeof request>;
}

/**
 * Creates an Express app with Epistery attached for testing
 */
export async function createTestApp(options?: {
  authentication?: (clientInfo: any) => Promise<any>;
  domain?: string;
}): Promise<TestApp> {
  // Set up environment before importing Epistery
  const testConfigPath = path.resolve(__dirname, 'config');
  process.env.EPISTERY_HOME = testConfigPath;
  process.env.HOME = testConfigPath;
  process.env.CHAIN_RPC_URL = TEST_PROVIDER.rpc;
  process.env.CHAIN_ID = String(TEST_PROVIDER.chainId);
  process.env.SERVER_DOMAIN = 'localhost';
  process.env.IPFS_URL = 'http://127.0.0.1:5001/api/v0';

  if (TEST_CONTRACT_ADDRESS) {
    process.env.AGENT_CONTRACT_ADDRESS = TEST_CONTRACT_ADDRESS;
  }

  // Dynamic import to ensure environment is set first
  const { Epistery } = await import('../index.mjs');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Initialize Epistery
  const epistery = await Epistery.connect({
    authentication: options?.authentication
  });

  await epistery.setDomain(options?.domain || 'localhost');
  await epistery.attach(app);

  return {
    app,
    epistery,
    supertest: request(app)
  };
}

/**
 * Get an ethers Wallet instance for a test wallet
 */
export function getWallet(walletKey: keyof typeof TEST_WALLETS): ethers.Wallet {
  const walletInfo = TEST_WALLETS[walletKey];
  const provider = new ethers.providers.JsonRpcProvider(TEST_PROVIDER.rpc);
  return ethers.Wallet.fromMnemonic(walletInfo.mnemonic).connect(provider);
}

/**
 * Get server wallet
 */
export function getServerWallet(): ethers.Wallet {
  return getWallet('server');
}

/**
 * Get client1 wallet
 */
export function getClient1Wallet(): ethers.Wallet {
  return getWallet('client1');
}

/**
 * Get client2 wallet
 */
export function getClient2Wallet(): ethers.Wallet {
  return getWallet('client2');
}

/**
 * Create a ClientWalletInfo object from a wallet
 */
export function createClientWalletInfo(wallet: ethers.Wallet): {
  address: string;
  publicKey: string;
  mnemonic: string;
  privateKey: string;
} {
  return {
    address: wallet.address,
    publicKey: wallet.publicKey,
    mnemonic: wallet.mnemonic?.phrase || '',
    privateKey: wallet.privateKey
  };
}

/**
 * Create key exchange request payload
 */
export async function createKeyExchangePayload(wallet: ethers.Wallet): Promise<{
  clientAddress: string;
  clientPublicKey: string;
  challenge: string;
  message: string;
  signature: string;
  walletSource: string;
}> {
  const challenge = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const message = `Epistery Key Exchange - ${wallet.address} - ${challenge}`;
  const signature = await wallet.signMessage(message);

  return {
    clientAddress: wallet.address,
    clientPublicKey: wallet.publicKey,
    challenge,
    message,
    signature,
    walletSource: 'browser'
  };
}

/**
 * Perform key exchange and return session cookie
 */
export async function performKeyExchange(
  supertest: ReturnType<typeof request>,
  wallet: ethers.Wallet
): Promise<{ cookie: string; response: any }> {
  const payload = await createKeyExchangePayload(wallet);

  const response = await supertest
    .post('/.well-known/epistery/connect')
    .send(payload)
    .expect(200);

  // Extract session cookie
  const cookies = response.headers['set-cookie'];
  const sessionCookie = cookies?.find((c: string) => c.startsWith('_epistery='));

  return {
    cookie: sessionCookie || '',
    response: response.body
  };
}

/**
 * Create a Bot authentication header
 */
export async function createBotAuthHeader(wallet: ethers.Wallet): Promise<string> {
  const message = `Whitelist auth ${Date.now()}`;
  const signature = await wallet.signMessage(message);

  const payload = {
    address: wallet.address,
    signature,
    message
  };

  return 'Bot ' + Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Create a session cookie for authenticated requests
 */
export function createSessionCookie(rivetAddress: string, publicKey?: string): string {
  const sessionData = {
    rivetAddress,
    publicKey: publicKey || '',
    authenticated: true,
    timestamp: new Date().toISOString()
  };
  return Buffer.from(JSON.stringify(sessionData)).toString('base64');
}

/**
 * Generate a unique test identifier
 */
export function uniqueId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique file name for testing
 */
export function uniqueFileName(): string {
  return `test-file-${uniqueId()}`;
}

/**
 * Generate a unique list name for testing
 */
export function uniqueListName(): string {
  return `test-list-${uniqueId()}`;
}

/**
 * Generate unique test data
 */
export function uniqueTestData(): object {
  return {
    testId: uniqueId(),
    timestamp: Date.now(),
    message: `Test data created at ${new Date().toISOString()}`
  };
}

/**
 * Wait for a transaction to be confirmed
 */
export async function waitForTransaction(
  txHash: string,
  timeout: number = 60000
): Promise<ethers.providers.TransactionReceipt> {
  const provider = new ethers.providers.JsonRpcProvider(TEST_PROVIDER.rpc);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      return receipt;
    }
    await sleep(2000);
  }

  throw new Error(`Transaction ${txHash} not confirmed within ${timeout}ms`);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a string is a valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if a string is a valid transaction hash
 */
export function isValidTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Check if a string is a valid IPFS hash
 */
export function isValidIPFSHash(hash: string): boolean {
  return /^Qm[a-zA-Z0-9]{44}$/.test(hash) || /^bafy[a-zA-Z0-9]+$/.test(hash);
}

/**
 * Get provider instance
 */
export function getProvider(): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(TEST_PROVIDER.rpc);
}

/**
 * Check wallet balance
 */
export async function getBalance(address: string): Promise<ethers.BigNumber> {
  const provider = getProvider();
  return provider.getBalance(address);
}

/**
 * Check if IPFS is available
 */
export async function isIPFSAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:5001/api/v0/id', {
      method: 'POST'
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Skip test if IPFS is not available
 */
export async function skipIfNoIPFS(): Promise<void> {
  const available = await isIPFSAvailable();
  if (!available) {
    throw new Error('IPFS not available - skipping test');
  }
}

/**
 * Skip test if contract is not deployed
 */
export function skipIfNoContract(): void {
  if (!TEST_CONTRACT_ADDRESS) {
    throw new Error('Contract not deployed - skipping test');
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const delay = initialDelay * Math.pow(2, i);
      await sleep(delay);
    }
  }

  throw lastError;
}
