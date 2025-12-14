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
 * List Management (use -p <port> for non-standard ports):
 *   epistery lists <domain>              Show all lists
 *   epistery list <domain> <listname>    Show list members
 *   epistery list add <domain> <list> <addr> [name] [role]  Add to list
 *   epistery list rm <domain> <list> <addr>   Remove from list
 *
 * Access Requests:
 *   epistery requests <domain>           Show pending access requests
 *   epistery approve <domain> <list> <addr> [role]  Approve request
 *   epistery deny <domain> <list> <addr> Deny request
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

// Base path for whitelist API endpoints
const WHITELIST_PATH = "/.well-known/epistery/whitelist";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root
dotenv.config({ path: join(__dirname, "../.env") });

// Role name to number mapping
const ROLE_MAP = {
  guest: 0,
  member: 1,
  moderator: 2,
  mod: 2,
  admin: 3,
  owner: 4,
};

const ROLE_NAMES = ["Guest", "Member", "Moderator", "Admin", "Owner"];

/**
 * Parse a role (name or number) to a role number
 * @param {string|number} role - Role name or number
 * @param {number} defaultRole - Default role if not specified
 * @returns {number} Role number (0-4)
 */
function parseRole(role, defaultRole = 1) {
  if (role === undefined || role === null || role === "") {
    return defaultRole;
  }

  // If it's already a number
  const num = parseInt(role);
  if (!isNaN(num) && num >= 0 && num <= 4) {
    return num;
  }

  // Try to match by name
  const roleLower = String(role).toLowerCase();
  if (roleLower in ROLE_MAP) {
    return ROLE_MAP[roleLower];
  }

  // Invalid role
  throw new Error(
    `Invalid role: "${role}". Valid roles: guest, member, moderator, admin, owner (or 0-4)`,
  );
}

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
      hint += "\n  Example: epistery lists localhost -p 3001";
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
      hint += "\n  Example: epistery lists localhost -p 3001";
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
    "  epistery curl [options] <url>             Make authenticated HTTP request",
  );
  console.log(
    "  epistery info [domain]                    Show domain information",
  );
  console.log(
    "  epistery set-default <domain>             Set default domain for CLI",
  );
  console.log("");
  console.log("List Management:");
  console.log(
    "  epistery lists <domain> [-p port]         Show all lists",
  );
  console.log(
    "  epistery list <domain> <listname> [-p port]",
  );
  console.log(
    "                                            Show list members",
  );
  console.log(
    "  epistery list add <domain> <list> <addr> [name] [role] [-p port]",
  );
  console.log(
    "                                            Add address to list",
  );
  console.log(
    "  epistery list rm <domain> <list> <addr> [-p port]",
  );
  console.log(
    "                                            Remove address from list",
  );
  console.log(
    "  epistery list check <domain> <list> <addr> [-p port]",
  );
  console.log(
    "                                            Check if address is on list",
  );
  console.log("");
  console.log("Access Requests:");
  console.log(
    "  epistery requests <domain> [-p port]      Show pending access requests",
  );
  console.log(
    "  epistery approve <domain> <list> <addr> [role] [-p port]",
  );
  console.log(
    "                                            Approve access request",
  );
  console.log(
    "  epistery deny <domain> <list> <addr> [-p port]",
  );
  console.log(
    "                                            Deny access request",
  );
  console.log("");
  console.log("Global Options:");
  console.log(
    "  -p, --port <port>        Server port (for localhost development)",
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
  console.log("Roles (use name or number):");
  console.log("  guest      (0) - Read-only access");
  console.log("  member     (1) - Standard access (default)");
  console.log("  moderator  (2) - Can moderate");
  console.log("  admin      (3) - Full admin access");
  console.log("  owner      (4) - Highest level");
  console.log("");
  console.log("Examples:");
  console.log("  # Initialize a domain (creates wallet)");
  console.log("  epistery initialize localhost");
  console.log("");
  console.log("  # List management (use -p for local dev server)");
  console.log("  epistery lists localhost -p 3001");
  console.log("  epistery list localhost epistery::admin -p 3001");
  console.log(
    '  epistery list add localhost epistery::admin 0x1234... "John Doe" admin -p 3001',
  );
  console.log("  epistery list rm localhost channel::general 0x5678... -p 3001");
  console.log("");
  console.log("  # Access requests");
  console.log("  epistery requests localhost -p 3001");
  console.log("  epistery approve localhost channel::premium 0x1234... member -p 3001");
  console.log("  epistery deny localhost channel::premium 0x5678... -p 3001");
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

      const contractAddress = config.data?.agent_contract_address;

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

/**
 * Build the base URL for a domain
 * Uses https by default, http for localhost
 * @param {string} domain - Domain name
 * @param {string|null} port - Optional port number
 */
function buildBaseUrl(domain, port = null) {
  const protocol = domain === "localhost" ? "http" : "https";
  const portSuffix = port ? `:${port}` : "";
  return `${protocol}://${domain}${portSuffix}`;
}

async function showAllLists(domain, port = null) {
  try {
    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/lists`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("");
    console.log(`Lists for domain: ${domain}`);
    console.log(`Total lists: ${data.count}`);
    console.log("");

    if (data.lists && data.lists.length > 0) {
      data.lists.forEach((list, index) => {
        console.log(`  ${index + 1}. ${list}`);
      });
    } else {
      console.log("No lists found.");
    }

    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function showList(domain, listName, port = null) {
  try {
    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/list?list=${encodeURIComponent(listName)}`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("");
    console.log(`List: ${data.listName}`);
    console.log(`Total members: ${data.count}`);
    console.log("");

    if (data.members && data.members.length > 0) {
      data.members.forEach((member, index) => {
        const addr = member.address || member.addr;
        const roleName = ROLE_NAMES[member.role] || `Role ${member.role}`;
        console.log(`  ${index + 1}. ${addr}`);
        if (member.name) {
          console.log(`      Name: ${member.name}`);
        }
        console.log(`      Role: ${roleName}`);
      });
    } else {
      console.log("No members in this list.");
    }

    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function addToList(domain, listName, address, name, role, port = null) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    const roleNum = parseRole(role, 1); // Default to Member (1)
    const roleName = ROLE_NAMES[roleNum] || `Role ${roleNum}`;

    console.log(`Adding ${address} to list "${listName}"`);
    console.log(`  Role: ${roleName}`);
    if (name) console.log(`  Name: ${name}`);
    console.log("");

    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/add`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        listName: listName,
        address: address,
        name: name || "",
        role: roleNum,
        meta: "",
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    console.log("");
    console.log("Address added to list successfully");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function removeFromList(domain, listName, address, port = null) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    console.log(`Removing ${address} from list "${listName}"`);
    console.log("");

    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/remove`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        listName: listName,
        address: address,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    console.log("");
    console.log("Address removed from list successfully");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function checkListMembership(domain, listName, address, port = null) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    const baseUrl = buildBaseUrl(domain, port);
    // Use the public list check endpoint (doesn't require auth)
    const url = `${baseUrl}/.well-known/epistery/list/check/${address}?list=${encodeURIComponent(listName)}`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("");
    console.log(`Address: ${address}`);
    console.log(`List: ${listName}`);
    console.log(`Is Listed: ${data.isListed ? "YES" : "NO"}`);
    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function showPendingRequests(domain, port = null) {
  try {
    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/pending-requests`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("");
    console.log(`Pending access requests for: ${domain}`);
    console.log(`Total pending: ${data.count}`);
    console.log("");

    if (data.requests && data.requests.length > 0) {
      data.requests.forEach((req, index) => {
        console.log(`  ${index + 1}. ${req.address}`);
        console.log(`      List: ${req.listName}`);
        if (req.message) {
          console.log(`      Message: ${req.message}`);
        }
        console.log(`      Requested: ${req.timestamp}`);
        console.log("");
      });

      console.log("To approve: epistery approve <domain> <list> <addr> [role] [-p port]");
      console.log("To deny:    epistery deny <domain> <list> <addr> [-p port]");
    } else {
      console.log("No pending access requests.");
    }

    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function approveRequest(domain, listName, address, role, port = null) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    const roleNum = parseRole(role, 1); // Default to Member (1)
    const roleName = ROLE_NAMES[roleNum] || `Role ${roleNum}`;

    console.log(`Approving ${address} for list "${listName}"`);
    console.log(`  Role: ${roleName}`);
    console.log("");

    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/handle-request`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: address,
        listName: listName,
        approved: true,
        role: roleNum,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    console.log("");
    console.log("Access request approved");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
    process.exit(1);
  }
}

async function denyRequest(domain, listName, address, port = null) {
  try {
    // Validate the address
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    console.log(`Denying ${address} for list "${listName}"`);
    console.log("");

    const wallet = CliWallet.load(domain);
    const authHeader = await wallet.createBotAuthHeader();
    const baseUrl = buildBaseUrl(domain, port);
    const url = `${baseUrl}${WHITELIST_PATH}/handle-request`;

    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: address,
        listName: listName,
        approved: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    console.log("");
    console.log("Access request denied");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("Error:", formatNetworkError(error, domain, port));
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
        curlArgs.push("-H", `Cookie: _rhonda_session=${session.cookie}`);
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

      case "lists":
        if (!args[0]) {
          console.error("Error: Domain name required");
          console.error("Usage: epistery lists <domain> [-p port]");
          process.exit(1);
        }
        await showAllLists(args[0], port);
        break;

      case "list":
        if (args.length === 0) {
          console.error("Error: Arguments required");
          console.error("Usage: epistery list <domain> <listname> [-p port]");
          console.error(
            "       epistery list add <domain> <list> <addr> [name] [role] [-p port]",
          );
          console.error("       epistery list rm <domain> <list> <addr> [-p port]");
          console.error("       epistery list check <domain> <list> <addr> [-p port]");
          process.exit(1);
        }

        if (args[0] === "add") {
          if (!args[1] || !args[2] || !args[3]) {
            console.error("Error: Domain, list name, and address required");
            console.error(
              "Usage: epistery list add <domain> <list> <addr> [name] [role] [-p port]",
            );
            process.exit(1);
          }
          await addToList(args[1], args[2], args[3], args[4], args[5], port);
        } else if (args[0] === "rm") {
          if (!args[1] || !args[2] || !args[3]) {
            console.error("Error: Domain, list name, and address required");
            console.error("Usage: epistery list rm <domain> <list> <addr> [-p port]");
            process.exit(1);
          }
          await removeFromList(args[1], args[2], args[3], port);
        } else if (args[0] === "check") {
          if (!args[1] || !args[2] || !args[3]) {
            console.error("Error: Domain, list name, and address required");
            console.error("Usage: epistery list check <domain> <list> <addr> [-p port]");
            process.exit(1);
          }
          await checkListMembership(args[1], args[2], args[3], port);
        } else {
          if (!args[0] || !args[1]) {
            console.error("Error: Domain and list name required");
            console.error("Usage: epistery list <domain> <listname> [-p port]");
            process.exit(1);
          }
          await showList(args[0], args[1], port);
        }
        break;

      case "requests":
        if (!args[0]) {
          console.error("Error: Domain name required");
          console.error("Usage: epistery requests <domain> [-p port]");
          process.exit(1);
        }
        await showPendingRequests(args[0], port);
        break;

      case "approve":
        if (!args[0] || !args[1] || !args[2]) {
          console.error("Error: Domain, list name, and address required");
          console.error(
            "Usage: epistery approve <domain> <list> <addr> [role] [-p port]",
          );
          process.exit(1);
        }
        await approveRequest(args[0], args[1], args[2], args[3], port);
        break;

      case "deny":
        if (!args[0] || !args[1] || !args[2]) {
          console.error("Error: Domain, list name, and address required");
          console.error("Usage: epistery deny <domain> <list> <addr> [-p port]");
          process.exit(1);
        }
        await denyRequest(args[0], args[1], args[2], port);
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
