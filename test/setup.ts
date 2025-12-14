import { ethers } from 'ethers';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

/**
 * Global test setup
 * Runs once before all tests
 */
export default async function globalSetup() {
  console.log('\n=== Epistery Test Suite Setup ===\n');

  // 0. Load .test.env file FIRST before importing fixtures
  const testEnvPath = path.resolve(__dirname, '..', '.test.env');
  if (fs.existsSync(testEnvPath)) {
    dotenv.config({ path: testEnvPath });
    console.log(`Loaded test env: ${testEnvPath}`);
  } else {
    throw new Error(
      `.test.env file not found at ${testEnvPath}\n` +
      'Copy .test.env.example to .test.env and fill in the values.'
    );
  }

  // Now import fixtures after env is loaded
  const { TEST_WALLETS, TEST_PROVIDER, TEST_CONTRACT_ADDRESS } = await import('./fixtures/wallets');

  // 1. Override HOME to use test config directory
  const testConfigPath = path.resolve(__dirname, 'config');
  process.env.EPISTERY_HOME = testConfigPath;
  process.env.HOME = testConfigPath;
  process.env.USERPROFILE = testConfigPath; // Windows compatibility

  console.log(`Config directory: ${testConfigPath}`);

  // 2. Set required environment variables
  process.env.CHAIN_RPC_URL = TEST_PROVIDER.rpc;
  process.env.CHAIN_ID = String(TEST_PROVIDER.chainId);
  process.env.SERVER_DOMAIN = 'localhost';
  process.env.IPFS_URL = 'http://127.0.0.1:5001/api/v0';

  if (TEST_CONTRACT_ADDRESS) {
    process.env.AGENT_CONTRACT_ADDRESS = TEST_CONTRACT_ADDRESS;
  }

  // 3. Generate test config files from environment variables
  const localhostDir = path.join(testConfigPath, 'localhost');
  if (!fs.existsSync(testConfigPath)) {
    fs.mkdirSync(testConfigPath, { recursive: true });
  }
  if (!fs.existsSync(localhostDir)) {
    fs.mkdirSync(localhostDir, { recursive: true });
  }

  // Write root config
  const rootConfig = `[profile]
name=Test Profile
email=test@epistery.test

[ipfs]
url=http://127.0.0.1:5001/api/v0
gateway=http://localhost:8080

[default.provider]
chainId=${TEST_PROVIDER.chainId}
name=${TEST_PROVIDER.name}
rpc=${TEST_PROVIDER.rpc}
nativeCurrencyName=${TEST_PROVIDER.nativeCurrencyName}
nativeCurrencySymbol=${TEST_PROVIDER.nativeCurrencySymbol}
nativeCurrencyDecimals=${TEST_PROVIDER.nativeCurrencyDecimals}

[cli]
default_domain=localhost
`;
  fs.writeFileSync(path.join(testConfigPath, 'config.ini'), rootConfig);

  // Write localhost domain config
  const localhostConfig = `domain=localhost
agent_contract_address=${TEST_CONTRACT_ADDRESS || ''}

[wallet]
address=${TEST_WALLETS.server.address}
mnemonic=${TEST_WALLETS.server.mnemonic}
publicKey=${TEST_WALLETS.server.publicKey}
privateKey=${TEST_WALLETS.server.privateKey}

[provider]
name=${TEST_PROVIDER.name}
chainId=${TEST_PROVIDER.chainId}
rpc=${TEST_PROVIDER.rpc}
nativeCurrencySymbol=${TEST_PROVIDER.nativeCurrencySymbol}
nativeCurrencyName=${TEST_PROVIDER.nativeCurrencyName}
nativeCurrencyDecimals=${TEST_PROVIDER.nativeCurrencyDecimals}
`;
  fs.writeFileSync(path.join(localhostDir, 'config.ini'), localhostConfig);

  console.log('Test config files: Generated from .test.env');

  // 4. Verify testnet connectivity
  const provider = new ethers.providers.JsonRpcProvider(TEST_PROVIDER.rpc);
  try {
    const network = await provider.getNetwork();
    console.log(`Connected to: ${network.name} (chainId: ${network.chainId})`);

    if (network.chainId !== TEST_PROVIDER.chainId) {
      throw new Error(`Chain ID mismatch: expected ${TEST_PROVIDER.chainId}, got ${network.chainId}`);
    }
  } catch (error) {
    console.error('Failed to connect to testnet:', error);
    throw new Error('Testnet connectivity required for tests. Ensure Polygon Amoy RPC is accessible.');
  }

  // 5. Verify IPFS connectivity
  try {
    const ipfsResponse = await fetch('http://127.0.0.1:5001/api/v0/id', {
      method: 'POST'
    });
    if (ipfsResponse.ok) {
      const ipfsId = await ipfsResponse.json();
      console.log(`IPFS daemon: OK (PeerID: ${ipfsId.ID?.slice(0, 16)}...)`);
    } else {
      console.warn('IPFS daemon not responding. Some tests may fail.');
    }
  } catch {
    console.warn('IPFS daemon not running. Start with: ipfs daemon');
    console.warn('Some tests requiring IPFS will be skipped.');
  }

  // 6. Check server wallet balance
  const serverBalance = await provider.getBalance(TEST_WALLETS.server.address);
  const balanceInPol = ethers.utils.formatEther(serverBalance);
  console.log(`Server wallet balance: ${balanceInPol} POL`);

  if (serverBalance.lt(ethers.utils.parseEther('0.01'))) {
    console.warn('\nWARNING: Server wallet has low balance!');
    console.warn(`Fund address ${TEST_WALLETS.server.address} with testnet POL`);
    console.warn('Get testnet POL from: https://faucet.polygon.technology/\n');
  }

  // 7. Check contract address
  if (!TEST_CONTRACT_ADDRESS) {
    console.warn('\nWARNING: TEST_CONTRACT_ADDRESS not set in .test.env');
    console.warn('Deploy contract first: npx hardhat run scripts/deploy-agent.js --network amoy');
    console.warn('Then set TEST_CONTRACT_ADDRESS in .test.env\n');
  } else {
    // Verify contract exists
    const code = await provider.getCode(TEST_CONTRACT_ADDRESS);
    if (code === '0x') {
      console.warn(`\nWARNING: No contract found at ${TEST_CONTRACT_ADDRESS}`);
    } else {
      console.log(`Contract verified: ${TEST_CONTRACT_ADDRESS.slice(0, 10)}...`);
    }
  }

  console.log('\n=== Setup Complete ===\n');
}
