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
  console.log('  epistery initialize <domain>              Initialize domain with wallet');
  console.log('  epistery curl [options] <url>             Make authenticated HTTP request');
  console.log('  epistery info [domain]                    Show domain information');
  console.log('  epistery set-default <domain>             Set default domain for CLI');
  console.log('');
  console.log('List Management:');
  console.log('  epistery lists <domain>                   Show all lists');
  console.log('  epistery list <domain> <listname>         Show list members');
  console.log('  epistery list add <domain> <list> <addr>  Add address to list');
  console.log('  epistery list rm <domain> <list> <addr>   Remove address from list');
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
  console.log('');
  console.log('  # List management');
  console.log('  epistery lists localhost');
  console.log('  epistery list localhost epistery::admin');
  console.log('  epistery list add localhost epistery::admin 0x1234...');
  console.log('  epistery list rm localhost message-board::moderator 0x5678...');
  console.log('');
  console.log('  # Make authenticated requests');
  console.log('  epistery curl https://wiki.rootz.global/wiki/Home');
  console.log('  epistery curl --bot -X POST -d \'{"title":"Test"}\' <url>');
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

async function showAllLists(domain) {
  try {
    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const url = `https://${domain}/agent/epistery/white-list/lists`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log('');
    console.log(`Lists for domain: ${domain}`);
    console.log(`Total lists: ${data.count}`);
    console.log('');

    if (data.lists && data.lists.length > 0) {
      data.lists.forEach((list, index) => {
        console.log(`  ${index + 1}. ${list}`);
      });
    } else {
      console.log('No lists found.');
    }

    console.log('');

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function showList(domain, listName) {
  try {
    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const url = `https://${domain}/agent/epistery/white-list/list?list=${encodeURIComponent(listName)}`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log('');
    console.log(`List: ${data.listName}`);
    console.log(`Total members: ${data.count}`);
    console.log('');

    if (data.members && data.members.length > 0) {
      data.members.forEach((member, index) => {
        console.log(`  ${index + 1}. ${member.address}`);
        if (member.name) {
          console.log(`      Name: ${member.name}`);
        }
        if (member.role) {
          console.log(`      Role: ${member.role}`);
        }
      });
    } else {
      console.log('No members in this list.');
    }

    console.log('');

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function addToList(domain, listName, address, name, role) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    console.log(`Adding ${address} to list ${listName} on domain: ${domain}`);
    console.log('');

    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const url = `https://${domain}/agent/epistery/white-list/add`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listName: listName,
        address: address,
        name: name || '',
        role: role || 0,
        meta: ''
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log('');
    console.log('✓ Address added to list successfully');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function removeFromList(domain, listName, address) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    console.log(`Removing ${address} from list ${listName} on domain: ${domain}`);
    console.log('');

    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const url = `https://${domain}/agent/epistery/white-list/remove`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listName: listName,
        address: address
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log('');
    console.log('✓ Address removed from list successfully');
    console.log('');

  } catch (error) {
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

      case 'lists':
        if (!args[0]) {
          console.error('Error: Domain name required');
          console.error('Usage: epistery lists <domain>');
          process.exit(1);
        }
        await showAllLists(args[0]);
        break;

      case 'list':
        if (args.length === 0) {
          console.error('Error: Arguments required');
          console.error('Usage: epistery list <domain> <listname>');
          console.error('       epistery list add <domain> <list> <addr> [name] [role]');
          console.error('       epistery list rm <domain> <list> <addr>');
          process.exit(1);
        }

        if (args[0] === 'add') {
          if (!args[1] || !args[2] || !args[3]) {
            console.error('Error: Domain, list name, and address required');
            console.error('Usage: epistery list add <domain> <list> <addr> [name] [role]');
            process.exit(1);
          }
          await addToList(args[1], args[2], args[3], args[4], args[5]);
        }
        else if (args[0] === 'rm') {
          if (!args[1] || !args[2] || !args[3]) {
            console.error('Error: Domain, list name, and address required');
            console.error('Usage: epistery list rm <domain> <list> <addr>');
            process.exit(1);
          }
          await removeFromList(args[1], args[2], args[3]);
        }
        else {
          if (!args[0] || !args[1]) {
            console.error('Error: Domain and list name required');
            console.error('Usage: epistery list <domain> <listname>');
            process.exit(1);
          }
          await showList(args[0], args[1]);
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
