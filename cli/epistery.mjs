#!/usr/bin/env node

/**
 * epistery - Unified CLI tool for Epistery
 *
 * Usage:
 *   epistery initialize <domain>         Initialize domain with wallet
 *   epistery curl [options] <url>        Make authenticated HTTP request
 *   epistery mcp [options] <url>         Stdio MCP bridge with bot-auth
 *   epistery info [domain]               Show domain information
 *   epistery set-default <domain>        Set default domain for CLI
 *
 * The curl subcommand automatically performs key exchange when needed.
 */

import { CliWallet } from "../dist/utils/CliWallet.js";
import { Utils } from "../dist/utils/Utils.js";
import { ethers } from "ethers";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root
dotenv.config({ path: join(__dirname, "../.env") });

/**
 * Extract global options from args (like -p/--port)
 * Returns { options, remainingArgs }
 */
function extractGlobalOptions(args) {
  const options = {
    port: null,
  };
  const remainingArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" || arg === "--port") {
      options.port = args[++i];
    } else {
      remainingArgs.push(arg);
    }
  }

  return { options, remainingArgs };
}

/**
 * Format error message with helpful suggestions
 * @param {Error} error - The error object
 * @param {string} domain - The domain being connected to
 * @param {string|null} port - The port (if specified)
 * @returns {string} Formatted error message with suggestions
 */
function formatNetworkError(error, domain, port) {
  const message = error.message || String(error);
  const cause = error.cause;

  // Check for common network error codes
  const errorCode = cause?.code || error.code;

  let hint = "";

  if (errorCode === "ECONNREFUSED" || message.includes("ECONNREFUSED")) {
    hint = "\n\nThe server refused the connection.";
    if (domain === "localhost" && !port) {
      hint += "\n→ If your server is running on a different port, use: -p <port>";
      hint += "\n  Example: epistery info localhost";
    } else {
      hint += "\n→ Make sure the server is running";
      if (port) {
        hint += ` on port ${port}`;
      }
    }
  } else if (errorCode === "ETIMEDOUT" || message.includes("ETIMEDOUT")) {
    hint = "\n\nThe connection timed out.";
    hint += "\n→ Check if the server is accessible";
    hint += "\n→ Check your network connection";
  } else if (errorCode === "ENOTFOUND" || message.includes("ENOTFOUND")) {
    hint = "\n\nCould not resolve the hostname.";
    hint += `\n→ Check that "${domain}" is a valid domain`;
    hint += "\n→ Check your DNS settings or network connection";
  } else if (errorCode === "ECONNRESET" || message.includes("ECONNRESET")) {
    hint = "\n\nThe connection was reset by the server.";
    hint += "\n→ The server may have crashed or restarted";
    hint += "\n→ Try again in a moment";
  } else if (message.includes("failed, reason:")) {
    // Generic fetch failure with empty reason
    hint = "\n\nCould not connect to the server.";
    if (domain === "localhost" && !port) {
      hint += "\n→ If your server is running on a different port, use: -p <port>";
      hint += "\n  Example: epistery info localhost";
    } else {
      hint += "\n→ Make sure the server is running and accessible";
    }
  }

  return message + hint;
}

function showHelp() {
  console.log("epistery - CLI tool for Epistery authentication and requests");
  console.log("");
  console.log("Usage:");
  console.log(
    "  epistery initialize <domain>              Initialize domain with wallet",
  );
  console.log(
    "  epistery mcp [-w domain] <url>            Stdio MCP bridge with bot-auth",
  );
  console.log(
    "  epistery curl [options] <url>             Make authenticated HTTP request",
  );
  console.log(
    "  epistery info [domain]                    Show domain information",
  );
  console.log(
    "  epistery set-default <domain>             Set default domain for CLI",
  );
  console.log("");
  console.log("Global Options:");
  console.log(
    "  -p, --port <port>        Server port (for localhost development)",
  );
  console.log("");
  console.log("mcp options:");
  console.log(
    "  -w, --wallet <domain>    Use specific domain wallet (overrides default)",
  );
  console.log("");
  console.log("curl options:");
  console.log(
    "  -w, --wallet <domain>    Use specific domain wallet (overrides default)",
  );
  console.log("  -X, --request <method>   HTTP method (default: GET)");
  console.log("  -d, --data <data>        Request body data");
  console.log("  -H, --header <header>    Additional headers");
  console.log(
    "  -b, --bot                Use bot auth header (default: session cookie)",
  );
  console.log("  -v, --verbose            Show detailed output");
  console.log("");
  console.log("Examples:");
  console.log("  # Initialize a domain (creates wallet)");
  console.log("  epistery initialize localhost");
  console.log("");
  console.log("  # MCP bridge (use with Claude Code or any MCP client)");
  console.log("  claude mcp add --transport stdio geist-social -- epistery mcp https://geist.social");
  console.log("");
  console.log("  # Make authenticated requests");
  console.log("  epistery curl https://example.com/api/data");
  console.log('  epistery curl --bot -X POST -d \'{"title":"Test"}\' <url>');
  console.log("");
  console.log("Domain configs stored in: ~/.epistery/{domain}/config.ini");
  console.log("Default domain set in: ~/.epistery/config.ini [cli] section");
}

async function initializeDomain(domain) {
  try {
    // Reject domains with colons (ports) - macOS can't handle colons in filenames
    if (domain.includes(':')) {
      console.error('Error: Domain cannot contain a colon (port number).');
      console.error('');
      console.error('The domain should be just the hostname, not hostname:port.');
      console.error('Example: Use "localhost" not "localhost:3001"');
      console.error('');
      console.error('The port is only for network connections - the domain identity');
      console.error('for authentication purposes is just the hostname.');
      process.exit(1);
    }

    console.log(`Initializing domain: ${domain}`);
    console.log("");

    const wallet = CliWallet.initialize(domain);

    console.log("");
    console.log("Domain initialized successfully");
    console.log("");

    // Try to add to epistery::admin list automatically
    let addedToAdmin = false;
    try {
      // Load config to get agent contract address
      const { Config } = await import("../dist/utils/Config.js");
      const config = new Config();
      config.setPath(`/${domain}`);
      config.load();

      const contractAddress = config.data?.contract_address;

      if (
        contractAddress &&
        contractAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        console.log("Adding wallet to epistery::admin list...");

        // Get the server wallet (which was just initialized)
        const serverWallet = Utils.InitServerWallet(domain);

        if (serverWallet) {
          await Utils.AddToWhitelist(
            serverWallet,
            "epistery::admin",
            wallet.address,
            "CLI Admin",
            3, // Admin role
            JSON.stringify({
              addedBy: serverWallet.address,
              addedMethod: "cli-initialize",
              timestamp: new Date().toISOString(),
            }),
            contractAddress,
          );
          console.log("Added to epistery::admin list");
          addedToAdmin = true;
        }
      } else {
        console.log("Note: No agent contract configured yet.");
        console.log("      Run server first, then add to admin list manually.");
      }
    } catch (adminError) {
      console.log("");
      console.log("Note: Could not add to epistery::admin list automatically.");
      console.log(`      Reason: ${adminError.message}`);
      console.log("");
      console.log("      Common reasons:");
      console.log("      - Wallet needs funds for gas fees");
      console.log("      - Agent contract not deployed yet");
      console.log("      - Network connectivity issues");
    }

    console.log("");
    console.log(
      "Configuration saved to: ~/.epistery/" + domain + "/config.ini",
    );
    console.log("Wallet address: " + wallet.address);
    console.log("");

    if (!addedToAdmin) {
      console.log(
        "To add as admin manually (after server is running with funds):",
      );
      console.log(
        `  epistery list add ${domain} epistery::admin ${wallet.address} "Admin" admin`,
      );
      console.log("");
    }

    console.log("Set as default with: epistery set-default " + domain);
    console.log("Make requests with: epistery curl https://example.com");
  } catch (error) {
    console.error("");
    console.error("Error:", error.message);
    process.exit(1);
  }
}

async function showInfo(domain) {
  try {
    const wallet = CliWallet.load(domain);

    console.log("Domain:", wallet.getDomain());
    console.log("Address:", wallet.address);
    console.log("Public Key:", wallet.publicKey);
    console.log("");

    const provider = wallet.getProvider();
    if (provider) {
      console.log("Provider:", provider.name);
      console.log("Chain ID:", provider.chainId);
      console.log("RPC:", provider.rpc);
      console.log("");
    }

    console.log(
      "Sessions: Stored per-server in ~/.epistery/" +
        wallet.getDomain() +
        "/sessions/",
    );
  } catch (error) {
    console.error("");
    console.error("Error:", error.message);
    process.exit(1);
  }
}

function setDefault(domain) {
  try {
    CliWallet.setDefaultDomain(domain);
    console.log(`✓ Default domain set to: ${domain}`);
    console.log("");
    console.log("Verify with: epistery info");
  } catch (error) {
    console.error("");
    console.error("Error:", error.message);
    process.exit(1);
  }
}


function parseCurlArgs(args) {
  const options = {
    domain: null, // null means use default
    method: "GET",
    data: null,
    headers: [],
    bot: true, // Use bot mode by default
    verbose: false,
    url: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-w":
      case "--wallet":
        options.domain = args[++i];
        break;

      case "-X":
      case "--request":
        options.method = args[++i].toUpperCase();
        break;

      case "-d":
      case "--data":
        options.data = args[++i];
        break;

      case "-H":
      case "--header":
        options.headers.push(args[++i]);
        break;

      case "-b":
      case "--bot":
        options.bot = true;
        break;

      case "-v":
      case "--verbose":
        options.verbose = true;
        break;

      default:
        if (!arg.startsWith("-")) {
          options.url = arg;
        } else {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!options.url) {
    throw new Error("URL required");
  }

  return options;
}

async function executeCurl(curlArgs) {
  return new Promise((resolve, reject) => {
    const curl = spawn("curl", curlArgs);

    let stdout = "";
    let stderr = "";

    curl.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    curl.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    curl.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    curl.on("error", (error) => {
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
      console.error(`[epistery] Auth mode: ${options.bot ? "bot" : "session"}`);
      console.error("");
    }

    // Build curl command
    const curlArgs = ["-s"]; // Silent mode

    if (options.verbose) {
      curlArgs.push("-v");
    }

    // HTTP method
    curlArgs.push("-X", options.method);

    // Authentication
    if (options.bot) {
      // Bot mode: Use Authorization header
      const authHeader = await wallet.createBotAuthHeader();
      curlArgs.push("-H", `Authorization: ${authHeader}`);
    } else {
      // Session mode: Check for existing session or perform key exchange
      // Extract base URL (protocol + host + port) for key exchange
      const url = new URL(options.url);
      const baseUrl = `${url.protocol}//${url.host}`;

      let session = wallet.getSession(baseUrl);

      if (!session) {
        if (options.verbose) {
          console.error(
            "[epistery] No session found, performing key exchange...",
          );
          console.error(`[epistery] Connecting to: ${baseUrl}`);
        }

        // Perform key exchange automatically
        const response = await wallet.performKeyExchange(baseUrl);

        if (options.verbose) {
          console.error(`[epistery] Key exchange successful`);
          console.error(`[epistery] Server: ${response.serverAddress}`);
          console.error(`[epistery] Authenticated: ${response.authenticated}`);
          console.error("");
        }

        session = wallet.getSession(baseUrl);
      }

      if (session && session.cookie) {
        curlArgs.push("-H", `Cookie: _epistery=${session.cookie}`);
      } else {
        throw new Error("Failed to obtain session cookie");
      }
    }

    // Request body
    if (options.data) {
      curlArgs.push("-H", "Content-Type: application/json");
      curlArgs.push("-d", options.data);
    }

    // Additional headers
    for (const header of options.headers) {
      curlArgs.push("-H", header);
    }

    // URL (last argument)
    curlArgs.push(options.url);

    if (options.verbose) {
      console.error("[epistery] Executing: curl", curlArgs.join(" "));
      console.error("");
    }

    const { stdout, stderr } = await executeCurl(curlArgs);

    if (stderr && options.verbose) {
      console.error(stderr);
    }

    console.log(stdout);
  } catch (error) {
    console.error("");
    console.error("Error:", error.message);
    process.exit(1);
  }
}

/**
 * MCP stdio bridge — reads JSON-RPC from stdin, POSTs to remote /mcp
 * with bot-auth, writes responses to stdout.
 *
 * Usage: epistery mcp [-w domain] <url>
 *   claude mcp add --transport stdio my-site -- epistery mcp https://my-site.example
 */
async function performMcp(args) {
  // Parse args: [-w domain] <url>
  let domain = null;
  let url = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-w' || arg === '--wallet') {
      domain = args[++i];
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
  }

  if (!url) {
    console.error('Error: URL required');
    console.error('Usage: epistery mcp [-w domain] <url>');
    process.exit(1);
  }

  // Ensure URL ends without trailing slash, append /mcp if not present
  const mcpUrl = url.replace(/\/+$/, '').endsWith('/mcp')
    ? url.replace(/\/+$/, '')
    : url.replace(/\/+$/, '') + '/mcp';

  const wallet = CliWallet.load(domain);
  const fetch = (await import('node-fetch')).default;

  // All log output to stderr so stdout stays clean for MCP JSON-RPC
  process.stderr.write(`[epistery-mcp] Bridge: ${wallet.address} -> ${mcpUrl}\n`);

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // Not valid JSON — ignore
      continue;
    }

    const isNotification = msg.id === undefined || msg.id === null;

    try {
      // Fresh bot-auth header per request (timestamp-based replay protection)
      const authHeader = await wallet.createBotAuthHeader();

      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(msg)
      });

      if (res.status === 204) {
        // No content (notification acknowledged) — nothing to write
        continue;
      }

      const body = await res.text();

      if (!res.ok) {
        // Server error — wrap in JSON-RPC error if this was a request
        if (!isNotification) {
          const errResponse = {
            jsonrpc: '2.0',
            error: { code: -32000, message: `HTTP ${res.status}: ${body}` },
            id: msg.id
          };
          process.stdout.write(JSON.stringify(errResponse) + '\n');
        }
        continue;
      }

      if (body) {
        process.stdout.write(body.trim() + '\n');
      }
    } catch (err) {
      // Network error
      if (!isNotification) {
        const errResponse = {
          jsonrpc: '2.0',
          error: { code: -32000, message: err.message },
          id: msg.id
        };
        process.stdout.write(JSON.stringify(errResponse) + '\n');
      }
      process.stderr.write(`[epistery-mcp] Error: ${err.message}\n`);
    }
  }
}

async function main() {
  const command = process.argv[2];
  const rawArgs = process.argv.slice(3);

  // Extract global options (like -p/--port) from args
  const { options: globalOpts, remainingArgs: args } =
    extractGlobalOptions(rawArgs);
  const port = globalOpts.port;

  try {
    switch (command) {
      case "initialize":
        if (!args[0]) {
          console.error("Error: Domain name required");
          console.error("Usage: epistery initialize <domain>");
          process.exit(1);
        }
        await initializeDomain(args[0]);
        break;

      case "mcp":
        if (rawArgs.length === 0) {
          console.error("Error: URL required");
          console.error("Usage: epistery mcp [-w domain] <url>");
          console.error("");
          console.error("Stdio MCP bridge with bot-auth. Register with Claude Code:");
          console.error("  claude mcp add --transport stdio my-site -- epistery mcp https://my-site.example");
          process.exit(1);
        }
        await performMcp(rawArgs);
        break;

      case "curl":
        if (rawArgs.length === 0) {
          console.error("Error: URL required");
          console.error("Usage: epistery curl [options] <url>");
          console.error("Run epistery --help for more information");
          process.exit(1);
        }
        // curl has its own option parsing, use rawArgs
        const curlOptions = parseCurlArgs(rawArgs);
        await performCurl(curlOptions);
        break;

      case "info":
        await showInfo(args[0] || null);
        break;

      case "set-default":
        if (!args[0]) {
          console.error("Error: Domain name required");
          console.error("Usage: epistery set-default <domain>");
          process.exit(1);
        }
        setDefault(args[0]);
        break;

      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;

      default:
        if (command) {
          console.error(`Error: Unknown command '${command}'`);
          console.error("");
        }
        showHelp();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error("");
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
