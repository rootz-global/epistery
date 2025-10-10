#!/usr/bin/env node

/**
 * epistery-curl - curl wrapper with Epistery authentication
 *
 * Wraps curl commands with Epistery authentication headers or session cookies
 *
 * Usage:
 *   epistery-curl [options] <url>
 *
 * Options:
 *   -w, --wallet <name>      Wallet name (default: 'default')
 *   -m, --method <method>    HTTP method (default: GET)
 *   -d, --data <data>        Request body data
 *   -H, --header <header>    Additional headers
 *   -b, --bot                Use bot authentication header instead of session cookie
 *   -v, --verbose            Show detailed request/response info
 *
 * Authentication modes:
 *   Default: Uses session cookie from epistery-auth connect
 *   --bot: Uses bot authentication header (sign per request)
 *
 * Examples:
 *   epistery-curl https://wiki.rootz.global/wiki/Home
 *   epistery-curl -m GET https://wiki.rootz.global/wiki/index
 *   epistery-curl -m PUT -d '{"title":"Test","body":"# Test"}' https://wiki.rootz.global/wiki/Test
 *   epistery-curl --bot -m GET https://wiki.rootz.global/session/context
 */

import { CliWallet } from '../dist/utils/CliWallet.js';
import { spawn } from 'child_process';
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

function parseArgs(argv) {
  const options = {
    wallet: DEFAULT_WALLET_NAME,
    method: 'GET',
    data: null,
    headers: [],
    bot: false,
    verbose: false,
    url: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '-w':
      case '--wallet':
        options.wallet = argv[++i];
        break;

      case '-m':
      case '--method':
        options.method = argv[++i].toUpperCase();
        break;

      case '-d':
      case '--data':
        options.data = argv[++i];
        break;

      case '-H':
      case '--header':
        options.headers.push(argv[++i]);
        break;

      case '-b':
      case '--bot':
        options.bot = true;
        break;

      case '-v':
      case '--verbose':
        options.verbose = true;
        break;

      case '-h':
      case '--help':
        showHelp();
        process.exit(0);
        break;

      default:
        if (!arg.startsWith('-')) {
          options.url = arg;
        } else {
          console.error(`Error: Unknown option '${arg}'`);
          process.exit(1);
        }
    }
  }

  if (!options.url) {
    console.error('Error: URL required');
    showHelp();
    process.exit(1);
  }

  return options;
}

async function buildCurlCommand(options) {
  const curlArgs = ['-s']; // Silent mode

  if (options.verbose) {
    curlArgs.push('-v');
  }

  // HTTP method
  curlArgs.push('-X', options.method);

  // Authentication
  if (options.bot) {
    // Bot mode: Use Authorization header
    const walletPath = getWalletPath(options.wallet);
    if (!fs.existsSync(walletPath)) {
      throw new Error(`Wallet '${options.wallet}' not found. Create with: epistery-auth create ${options.wallet}`);
    }

    const wallet = CliWallet.fromDefaultPath(options.wallet);
    const authHeader = await wallet.createBotAuthHeader();
    curlArgs.push('-H', `Authorization: ${authHeader}`);

  } else {
    // Session mode: Use cookie
    const sessionPath = getSessionPath(options.wallet);
    if (!fs.existsSync(sessionPath)) {
      throw new Error(
        `No session found for wallet '${options.wallet}'. ` +
        `Connect first with: epistery-auth connect <url> ${options.wallet}`
      );
    }

    const sessionToken = fs.readFileSync(sessionPath, 'utf8').trim();
    curlArgs.push('-H', `Cookie: _rhonda_session=${sessionToken}`);
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

  return curlArgs;
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

function showHelp() {
  console.log('epistery-curl - curl wrapper with Epistery authentication');
  console.log('');
  console.log('Usage:');
  console.log('  epistery-curl [options] <url>');
  console.log('');
  console.log('Options:');
  console.log('  -w, --wallet <name>      Wallet name (default: "default")');
  console.log('  -m, --method <method>    HTTP method (default: GET)');
  console.log('  -d, --data <data>        Request body data');
  console.log('  -H, --header <header>    Additional headers');
  console.log('  -b, --bot                Use bot authentication header');
  console.log('  -v, --verbose            Show detailed request/response');
  console.log('  -h, --help               Show this help');
  console.log('');
  console.log('Authentication:');
  console.log('  Default: Uses session cookie from epistery-auth connect');
  console.log('  --bot: Uses bot authentication header (signs per request)');
  console.log('');
  console.log('Examples:');
  console.log('  epistery-curl https://wiki.rootz.global/wiki/Home');
  console.log('  epistery-curl -m GET https://wiki.rootz.global/wiki/index');
  console.log('  epistery-curl --bot https://wiki.rootz.global/session/context');
  console.log('  epistery-curl -m PUT -d \'{"title":"Test","body":"# Test"}\' https://wiki.rootz.global/wiki/Test');
  console.log('');
  console.log('Setup:');
  console.log('  1. Create wallet: epistery-auth create my-bot');
  console.log('  2. Connect: epistery-auth connect https://wiki.rootz.global my-bot');
  console.log('  3. Make requests: epistery-curl -w my-bot <url>');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  try {
    const options = parseArgs(args);

    if (options.verbose) {
      console.error(`[epistery-curl] Wallet: ${options.wallet}`);
      console.error(`[epistery-curl] Method: ${options.method}`);
      console.error(`[epistery-curl] Auth mode: ${options.bot ? 'bot' : 'session'}`);
      console.error(`[epistery-curl] URL: ${options.url}`);
      console.error('');
    }

    const curlArgs = await buildCurlCommand(options);

    if (options.verbose) {
      console.error('[epistery-curl] Executing: curl', curlArgs.join(' '));
      console.error('');
    }

    const { stdout, stderr } = await executeCurl(curlArgs);

    // Output results
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

main();