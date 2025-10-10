#!/usr/bin/env node

/**
 * epistery-auth - CLI tool for Epistery authentication
 *
 * Manages wallet creation, key exchange, and session management for CLI/bot contexts
 *
 * Usage:
 *   epistery-auth create <name>              Create a new wallet
 *   epistery-auth connect <url> [name]       Perform key exchange with server
 *   epistery-auth info [name]                Show wallet information
 *   epistery-auth bot-header [name]          Generate bot authentication header
 */

import { CliWallet } from '../dist/utils/CliWallet.js';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

const DEFAULT_WALLET_NAME = 'default';

function getWalletPath(name) {
  return path.resolve(homedir(), '.epistery', `${name}-wallet.json`);
}

function getSessionPath(name) {
  return path.resolve(homedir(), '.epistery', `${name}-session.txt`);
}

async function createWallet(name) {
  const walletPath = getWalletPath(name);

  if (fs.existsSync(walletPath)) {
    console.error(`Error: Wallet '${name}' already exists at ${walletPath}`);
    console.error('Use a different name or delete the existing wallet');
    process.exit(1);
  }

  console.log(`Creating new wallet: ${name}`);

  const wallet = CliWallet.create();
  const savedPath = wallet.saveToDefaultPath(name);

  console.log('✓ Wallet created successfully');
  console.log('');
  console.log('Address:', wallet.address);
  console.log('Public Key:', wallet.publicKey);
  console.log('');
  console.log('Saved to:', savedPath);
  console.log('');
  console.log('⚠️  Keep this file secure! It contains your private key.');
}

async function connectToServer(url, name) {
  const walletPath = getWalletPath(name);

  if (!fs.existsSync(walletPath)) {
    console.error(`Error: Wallet '${name}' not found at ${walletPath}`);
    console.error(`Create a wallet first with: epistery-auth create ${name}`);
    process.exit(1);
  }

  console.log(`Connecting to ${url} with wallet '${name}'`);
  console.log('');

  try {
    const wallet = CliWallet.fromDefaultPath(name);

    console.log('Wallet address:', wallet.address);
    console.log('Performing key exchange...');

    const { response, cookies } = await wallet.performKeyExchange(url);

    console.log('✓ Key exchange completed successfully');
    console.log('');
    console.log('Server address:', response.serverAddress);
    console.log('Available services:', response.services.join(', '));
    console.log('Authenticated:', response.authenticated);

    if (response.profile) {
      console.log('Profile:', JSON.stringify(response.profile, null, 2));
    }

    // Save session cookie if present
    if (cookies) {
      const sessionMatch = cookies.match(/_rhonda_session=([^;]+)/);
      if (sessionMatch) {
        const sessionToken = sessionMatch[1];
        const sessionPath = getSessionPath(name);
        fs.writeFileSync(sessionPath, sessionToken, { mode: 0o600 });
        console.log('');
        console.log('Session token saved to:', sessionPath);
      }
    }

    console.log('');
    console.log('✓ Ready for authenticated requests');

  } catch (error) {
    console.error('');
    console.error('✗ Connection failed:', error.message);
    process.exit(1);
  }
}

async function showInfo(name) {
  const walletPath = getWalletPath(name);

  if (!fs.existsSync(walletPath)) {
    console.error(`Error: Wallet '${name}' not found at ${walletPath}`);
    console.error(`Create a wallet first with: epistery-auth create ${name}`);
    process.exit(1);
  }

  const wallet = CliWallet.fromDefaultPath(name);
  const sessionPath = getSessionPath(name);

  console.log('Wallet:', name);
  console.log('Address:', wallet.address);
  console.log('Public Key:', wallet.publicKey);
  console.log('Location:', walletPath);
  console.log('');

  if (fs.existsSync(sessionPath)) {
    console.log('Session: Active');
    console.log('Session file:', sessionPath);
  } else {
    console.log('Session: None');
    console.log('Connect with: epistery-auth connect <url>', name);
  }
}

async function generateBotHeader(name) {
  const walletPath = getWalletPath(name);

  if (!fs.existsSync(walletPath)) {
    console.error(`Error: Wallet '${name}' not found at ${walletPath}`);
    console.error(`Create a wallet first with: epistery-auth create ${name}`);
    process.exit(1);
  }

  const wallet = CliWallet.fromDefaultPath(name);
  const authHeader = await wallet.createBotAuthHeader();

  console.log(authHeader);
}

function showHelp() {
  console.log('epistery-auth - CLI tool for Epistery authentication');
  console.log('');
  console.log('Usage:');
  console.log('  epistery-auth create <name>              Create a new wallet');
  console.log('  epistery-auth connect <url> [name]       Perform key exchange with server');
  console.log('  epistery-auth info [name]                Show wallet information');
  console.log('  epistery-auth bot-header [name]          Generate bot authentication header');
  console.log('');
  console.log('Examples:');
  console.log('  epistery-auth create my-bot');
  console.log('  epistery-auth connect https://wiki.rootz.global my-bot');
  console.log('  epistery-auth info my-bot');
  console.log('  epistery-auth bot-header my-bot');
  console.log('');
  console.log('Default wallet name: default');
  console.log('Wallet storage: ~/.epistery/');
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'create':
        if (!args[0]) {
          console.error('Error: Wallet name required');
          console.error('Usage: epistery-auth create <name>');
          process.exit(1);
        }
        await createWallet(args[0]);
        break;

      case 'connect':
        if (!args[0]) {
          console.error('Error: Server URL required');
          console.error('Usage: epistery-auth connect <url> [name]');
          process.exit(1);
        }
        await connectToServer(args[0], args[1] || DEFAULT_WALLET_NAME);
        break;

      case 'info':
        await showInfo(args[0] || DEFAULT_WALLET_NAME);
        break;

      case 'bot-header':
        await generateBotHeader(args[0] || DEFAULT_WALLET_NAME);
        break;

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        if (command) {
          console.error(`Error: Unknown command '${command}'`);
          console.error('');
        }
        showHelp();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();