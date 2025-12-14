#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { ethers } = require("ethers");
const ini = require("ini");

/**
 * Fund test wallets script
 *
 * Funds wallets defined in .test.env with testnet POL from the server wallet
 * located at ~/.epistery/localhost
 *
 * Usage:
 *   node scripts/fund-test-wallets.js
 */

const FUND_AMOUNT = "0.5"; // POL

function loadTestEnv() {
  const testEnvPath = path.join(__dirname, "..", ".test.env");

  if (!fs.existsSync(testEnvPath)) {
    console.error("Error: .test.env file not found at", testEnvPath);
    console.error("Copy .test.env.example to .test.env and fill in the wallet addresses.");
    process.exit(1);
  }

  const content = fs.readFileSync(testEnvPath, "utf8");
  const env = {};

  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key) {
        env[key.trim()] = valueParts.join("=").trim();
      }
    }
  });

  return env;
}

function loadServerWallet() {
  const configPath = path.join(
    process.env.HOME,
    ".epistery",
    "localhost",
    "config.ini"
  );

  if (!fs.existsSync(configPath)) {
    console.error("Error: Server wallet config not found at", configPath);
    console.error("Run 'npx epistery initialize localhost' first.");
    process.exit(1);
  }

  const content = fs.readFileSync(configPath, "utf8");
  const config = ini.parse(content);

  if (!config.wallet?.privateKey) {
    console.error("Error: No private key found in server wallet config.");
    process.exit(1);
  }

  return {
    address: config.wallet.address,
    privateKey: config.wallet.privateKey,
    rpc: config.provider?.rpc || "https://rpc-amoy.polygon.technology",
  };
}

function getWalletsToFund(testEnv) {
  const wallets = [];

  // Check for wallet addresses in .test.env
  const walletKeys = [
    { key: "TEST_SERVER_ADDRESS", name: "Test Server" },
    { key: "TEST_CLIENT1_ADDRESS", name: "Test Client 1" },
    { key: "TEST_CLIENT2_ADDRESS", name: "Test Client 2" },
  ];

  for (const { key, name } of walletKeys) {
    const address = testEnv[key];
    if (address && ethers.utils.isAddress(address)) {
      wallets.push({ name, address });
    }
  }

  return wallets;
}

async function promptConfirmation(wallets, fundAmount, serverAddress) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n=== Fund Test Wallets ===\n");
  console.log(`Funding from: ${serverAddress}`);
  console.log(`Amount per wallet: ${fundAmount} POL\n`);
  console.log("Wallets to fund:");
  console.log("-".repeat(60));

  for (const wallet of wallets) {
    console.log(`  ${wallet.name}:`);
    console.log(`    ${wallet.address}`);
  }

  console.log("-".repeat(60));
  console.log(`\nTotal: ${wallets.length} wallets x ${fundAmount} POL = ${wallets.length * parseFloat(fundAmount)} POL\n`);

  return new Promise((resolve) => {
    rl.question("Are you sure you want to fund these wallets? (yes/no): ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}

async function fundWallet(wallet, toAddress, toName, amount) {
  console.log(`\nFunding ${toName}...`);
  console.log(`  To: ${toAddress}`);

  // Get current gas price and add 50% buffer for Polygon network requirements
  const gasPrice = await wallet.getGasPrice();
  const adjustedGasPrice = gasPrice.mul(150).div(100);

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: ethers.utils.parseEther(amount),
    gasPrice: adjustedGasPrice,
  });

  console.log(`  Tx hash: ${tx.hash}`);
  console.log("  Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`  Confirmed in block ${receipt.blockNumber}`);

  return receipt;
}

async function main() {
  // Load configurations
  const testEnv = loadTestEnv();
  const serverWallet = loadServerWallet();
  const walletsToFund = getWalletsToFund(testEnv);

  if (walletsToFund.length === 0) {
    console.error("Error: No valid wallet addresses found in .test.env");
    console.error("Make sure TEST_SERVER_ADDRESS, TEST_CLIENT1_ADDRESS, or TEST_CLIENT2_ADDRESS are set.");
    process.exit(1);
  }

  // Connect to provider
  const provider = new ethers.providers.JsonRpcProvider(serverWallet.rpc);
  const wallet = new ethers.Wallet(serverWallet.privateKey, provider);

  // Check server wallet balance
  const balance = await wallet.getBalance();
  const balanceInPol = ethers.utils.formatEther(balance);
  const requiredAmount = walletsToFund.length * parseFloat(FUND_AMOUNT);

  console.log(`\nServer wallet balance: ${balanceInPol} POL`);

  if (parseFloat(balanceInPol) < requiredAmount) {
    console.error(`\nError: Insufficient balance. Need at least ${requiredAmount} POL.`);
    process.exit(1);
  }

  // Prompt for confirmation
  const confirmed = await promptConfirmation(walletsToFund, FUND_AMOUNT, serverWallet.address);

  if (!confirmed) {
    console.log("\nFunding cancelled.");
    process.exit(0);
  }

  console.log("\n=== Starting Funding ===");

  // Fund each wallet
  for (const { name, address } of walletsToFund) {
    try {
      await fundWallet(wallet, address, name, FUND_AMOUNT);
    } catch (error) {
      console.error(`\nError funding ${name}: ${error.message}`);
    }
  }

  // Show final balance
  const finalBalance = await wallet.getBalance();
  console.log(`\n=== Funding Complete ===`);
  console.log(`Server wallet remaining balance: ${ethers.utils.formatEther(finalBalance)} POL`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error.message);
    process.exit(1);
  });
