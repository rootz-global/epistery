#!/usr/bin/env node

/**
 * epistery - Unified CLI tool for Epistery
 *
 * Usage:
 *   epistery initialize <domain>         Initialize domain with wallet
 *   epistery curl [options] <url>        Make authenticated HTTP request
 *   epistery info [domain]               Show domain information
 *   epistery set-default <domain>        Set default domain for CLI
 *
 * The curl subcommand automatically performs key exchange when needed.
 */

import { CliWallet } from '../dist/utils/CliWallet.js';
import { Utils } from '../dist/utils/Utils.js';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root
dotenv.config({ path: join(__dirname, '../.env') });

function showHelp() {
  console.log('epistery - CLI tool for Epistery authentication and requests');
  console.log('');
  console.log('Usage:');
  console.log('  epistery initialize <domain>         Initialize domain with wallet');
  console.log('  epistery curl [options] <url>        Make authenticated HTTP request');
  console.log('  epistery info [domain]               Show domain information');
  console.log('  epistery set-default <domain>        Set default domain for CLI');
  console.log('  epistery whitelist <domain> <addr>   Add address to domain whitelist');
  console.log('  epistery whitelist -d <domain> <a>   Remove address from whitelist');
  console.log('  epistery whitelist status <domain>   Show domain whitelist status');
  console.log('');
  console.log('curl options:');
  console.log('  -w, --wallet <domain>    Use specific domain wallet (overrides default)');
  console.log('  -X, --request <method>   HTTP method (default: GET)');
  console.log('  -d, --data <data>        Request body data');
  console.log('  -H, --header <header>    Additional headers');
  console.log('  -b, --bot                Use bot auth header (default: session cookie)');
  console.log('  -v, --verbose            Show detailed output');
  console.log('');
  console.log('Examples:');
  console.log('  # Initialize a domain (creates wallet)');
  console.log('  epistery initialize localhost');
  console.log('  epistery initialize wiki.rootz.global');
  console.log('');
  console.log('  # Set default domain');
  console.log('  epistery set-default localhost');
  console.log('');
  console.log('  # Whitelist management');
  console.log('  epistery whitelist localhost 0x1234567890123456789012345678901234567890');
  console.log('  epistery whitelist -d localhost 0x1234567890123456789012345678901234567890');
  console.log('  epistery whitelist status localhost');
  console.log('');
  console.log('  # Make requests (uses default domain)');
  console.log('  epistery curl https://wiki.rootz.global/wiki/Home');
  console.log('  epistery curl -X GET https://wiki.rootz.global/wiki/index');
  console.log('');
  console.log('  # Use specific domain');
  console.log('  epistery curl -w localhost https://localhost:4080/session/context');
  console.log('');
  console.log('  # Bot mode (sign per request, no session)');
  console.log('  epistery curl --bot -X GET https://wiki.rootz.global/session/context');
  console.log('');
  console.log('  # POST request');
  console.log('  epistery curl -X POST -d \'{"title":"Test","body":"# Test"}\' <url>');
  console.log('');
  console.log('Domain configs stored in: ~/.epistery/{domain}/config.ini');
  console.log('Default domain set in: ~/.epistery/config.ini [cli] section');
}

async function initializeDomain(domain) {
  try {
    console.log(`Initializing domain: ${domain}`);
    console.log('');

    const wallet = CliWallet.initialize(domain);

    console.log('');
    console.log('✓ Domain initialized successfully');
    console.log('');
    console.log('Configuration saved to: ~/.epistery/' + domain + '/config.ini');
    console.log('');
    console.log('Set as default with: epistery set-default ' + domain);
    console.log('Make requests with: epistery curl https://example.com');

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function showInfo(domain) {
  try {
    const wallet = CliWallet.load(domain);

    console.log('Domain:', wallet.getDomain());
    console.log('Address:', wallet.address);
    console.log('Public Key:', wallet.publicKey);
    console.log('');

    const provider = wallet.getProvider();
    if (provider) {
      console.log('Provider:', provider.name);
      console.log('Chain ID:', provider.chainId);
      console.log('RPC:', provider.rpc);
      console.log('');
    }

    console.log('Sessions: Stored per-server in ~/.epistery/' + wallet.getDomain() + '/sessions/');

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function setDefault(domain) {
  try {
    CliWallet.setDefaultDomain(domain);
    console.log(`✓ Default domain set to: ${domain}`);
    console.log('');
    console.log('Verify with: epistery info');
  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function addToWhitelist(domain, address) {
  try {
    console.log(`Adding ${address} to whitelist for domain: ${domain}`);
    console.log('');

    const cliWallet = CliWallet.load(domain);
    const domainConfig = Utils.GetDomainInfo(domain);
    if (!domainConfig.wallet) {
      throw new Error(`No wallet found for domain: ${domain}`);
    }

    const provider = cliWallet.getProvider();
    if (!provider || !provider.rpc) {
      throw new Error(`No provider configured for domain: ${domain}`);
    }

    const ethersProvider = new ethers.providers.JsonRpcProvider(provider.rpc);
    let wallet;
    if (domainConfig.wallet.mnemonic) {
      wallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic).connect(ethersProvider);
    }
    else if (domainConfig.wallet.privateKey) {
      wallet = new ethers.Wallet(domainConfig.wallet.privateKey, ethersProvider);
    }
    else {
      throw new Error(`No wallet credentials found for domain: ${domain}`);
    }

    // Validate the address to add
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    const receipt = await Utils.AddToWhitelist(wallet, address, domain);

    console.log('');
    console.log('✓ Address added to whitelist successfully');
    console.log('');
    console.log(`Transaction hash: ${receipt.transactionHash}`);

  }
  catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function removeFromWhitelist(domain, address) {
  try {
    console.log(`Removing ${address} from whitelist for domain: ${domain}`);
    console.log('');

    const cliWallet = CliWallet.load(domain);
    const domainConfig = Utils.GetDomainInfo(domain);
    if (!domainConfig.wallet) {
      throw new Error(`No wallet found for domain: ${domain}`);
    }

    // Get the provider and connect the wallet
    const provider = cliWallet.getProvider();
    if (!provider || !provider.rpc) {
      throw new Error(`No provider configured for domain: ${domain}`);
    }

    const ethersProvider = new ethers.providers.JsonRpcProvider(provider.rpc);
    let wallet;
    if (domainConfig.wallet.mnemonic) {
      wallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic).connect(ethersProvider);
    }
    else if (domainConfig.wallet.privateKey) {
      wallet = new ethers.Wallet(domainConfig.wallet.privateKey, ethersProvider);
    }
    else {
      throw new Error(`No wallet credentials found for domain: ${domain}`);
    }

    // Validate the address to remove
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    const receipt = await Utils.RemoveFromWhitelist(wallet, address, domain);

    console.log('');
    console.log('Address removed from whitelist successfully');
    console.log('');
    console.log(`Transaction hash: ${receipt.transactionHash}`);

  }
  catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function showWhitelistStatus(domain) {
  try {
    console.log(`Fetching whitelist status for domain: ${domain}`);
    console.log('');

    const cliWallet = CliWallet.load(domain);
    const domainConfig = Utils.GetDomainInfo(domain);
    if (!domainConfig.wallet) {
      throw new Error(`No wallet found for domain: ${domain}`);
    }

    const provider = cliWallet.getProvider();
    if (!provider || !provider.rpc) {
      throw new Error(`No provider configured for domain: ${domain}`);
    }

    const ethersProvider = new ethers.providers.JsonRpcProvider(provider.rpc);
    let wallet;
    if (domainConfig.wallet.mnemonic) {
      wallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic).connect(ethersProvider);
    }
    else if (domainConfig.wallet.privateKey) {
      wallet = new ethers.Wallet(domainConfig.wallet.privateKey, ethersProvider);
    }
    else {
      throw new Error(`No wallet credentials found for domain: ${domain}`);
    }

    const whitelist = await Utils.GetWhitelist(wallet, cliWallet.address, domain);

    console.log('');
    console.log(`Whitelist for domain: ${domain}`);
    console.log(`Owner address: ${cliWallet.address}`);
    console.log(`Total whitelisted addresses: ${whitelist.length}`);
    console.log('');

    if (whitelist.length > 0) {
      console.log('Whitelisted addresses:');
      whitelist.forEach((addr, index) => {
        console.log(`  ${index + 1}. ${addr}`);
      });
    }
    else {
      console.log('No addresses whitelisted yet.');
    }

    console.log('');

  } 
  catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function parseCurlArgs(args) {
  const options = {
    domain: null,  // null means use default
    method: 'GET',
    data: null,
    headers: [],
    bot: true,  // Use bot mode by default
    verbose: false,
    url: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-w':
      case '--wallet':
        options.domain = args[++i];
        break;

      case '-X':
      case '--request':
        options.method = args[++i].toUpperCase();
        break;

      case '-d':
      case '--data':
        options.data = args[++i];
        break;

      case '-H':
      case '--header':
        options.headers.push(args[++i]);
        break;

      case '-b':
      case '--bot':
        options.bot = true;
        break;

      case '-v':
      case '--verbose':
        options.verbose = true;
        break;

      default:
        if (!arg.startsWith('-')) {
          options.url = arg;
        } else {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!options.url) {
    throw new Error('URL required');
  }

  return options;
}

async function executeCurl(curlArgs) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', curlArgs);

    let stdout = '';
    let stderr = '';

    curl.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    curl.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    curl.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`curl exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    curl.on('error', (error) => {
      reject(new Error(`Failed to execute curl: ${error.message}`));
    });
  });
}

async function performCurl(options) {
  try {
    // Load wallet (uses default if domain not specified)
    const wallet = CliWallet.load(options.domain);

    if (options.verbose) {
      console.error(`[epistery] Domain: ${wallet.getDomain()}`);
      console.error(`[epistery] Address: ${wallet.address}`);
      console.error(`[epistery] Auth mode: ${options.bot ? 'bot' : 'session'}`);
      console.error('');
    }

    // Build curl command
    const curlArgs = ['-s']; // Silent mode

    if (options.verbose) {
      curlArgs.push('-v');
    }

    // HTTP method
    curlArgs.push('-X', options.method);

    // Authentication
    if (options.bot) {
      // Bot mode: Use Authorization header
      const authHeader = await wallet.createBotAuthHeader();
      curlArgs.push('-H', `Authorization: ${authHeader}`);

    } else {
      // Session mode: Check for existing session or perform key exchange
      // Extract base URL (protocol + host + port) for key exchange
      const url = new URL(options.url);
      const baseUrl = `${url.protocol}//${url.host}`;

      let session = wallet.getSession(baseUrl);

      if (!session) {
        if (options.verbose) {
          console.error('[epistery] No session found, performing key exchange...');
          console.error(`[epistery] Connecting to: ${baseUrl}`);
        }

        // Perform key exchange automatically
        const response = await wallet.performKeyExchange(baseUrl);

        if (options.verbose) {
          console.error(`[epistery] Key exchange successful`);
          console.error(`[epistery] Server: ${response.serverAddress}`);
          console.error(`[epistery] Authenticated: ${response.authenticated}`);
          console.error('');
        }

        session = wallet.getSession(baseUrl);
      }

      if (session && session.cookie) {
        curlArgs.push('-H', `Cookie: _rhonda_session=${session.cookie}`);
      } else {
        throw new Error('Failed to obtain session cookie');
      }
    }

    // Request body
    if (options.data) {
      curlArgs.push('-H', 'Content-Type: application/json');
      curlArgs.push('-d', options.data);
    }

    // Additional headers
    for (const header of options.headers) {
      curlArgs.push('-H', header);
    }

    // URL (last argument)
    curlArgs.push(options.url);

    if (options.verbose) {
      console.error('[epistery] Executing: curl', curlArgs.join(' '));
      console.error('');
    }

    const { stdout, stderr } = await executeCurl(curlArgs);

    if (stderr && options.verbose) {
      console.error(stderr);
    }

    console.log(stdout);

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'initialize':
        if (!args[0]) {
          console.error('Error: Domain name required');
          console.error('Usage: epistery initialize <domain>');
          process.exit(1);
        }
        await initializeDomain(args[0]);
        break;

      case 'curl':
        if (args.length === 0) {
          console.error('Error: URL required');
          console.error('Usage: epistery curl [options] <url>');
          console.error('Run epistery --help for more information');
          process.exit(1);
        }
        const curlOptions = parseCurlArgs(args);
        await performCurl(curlOptions);
        break;

      case 'info':
        await showInfo(args[0] || null);
        break;

      case 'set-default':
        if (!args[0]) {
          console.error('Error: Domain name required');
          console.error('Usage: epistery set-default <domain>');
          process.exit(1);
        }
        setDefault(args[0]);
        break;

      case 'whitelist':
        if (args.length === 0) {
          console.error('Error: Arguments required');
          console.error('Usage: epistery whitelist <domain> <address>');
          console.error('       epistery whitelist -d <domain> <address>');
          console.error('       epistery whitelist status <domain>');
          process.exit(1);
        }

        if (args[0] === 'status') {
          if (!args[1]) {
            console.error('Error: Domain name required');
            console.error('Usage: epistery whitelist status <domain>');
            process.exit(1);
          }

          await showWhitelistStatus(args[1]);
        }
        else if (args[0] === '-d' || args[0] === '--delete') {
          if (!args[1] || !args[2]) {
            console.error('Error: Domain and address required');
            console.error('Usage: epistery whitelist -d <domain> <address>');
            process.exit(1);
          }

          await removeFromWhitelist(args[1], args[2]);
        }
        else {
          if (!args[0] || !args[1]) {
            console.error('Error: Domain and address required');
            console.error('Usage: epistery whitelist <domain> <address>');
            process.exit(1);
          }
          await addToWhitelist(args[0], args[1]);
        }
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
