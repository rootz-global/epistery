const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const ini = require("ini");
const os = require("os");

/**
 * Read per-chain policy from ~/.epistery/config.ini under
 * [default.rpc.<chainId>.policy]. Returns {} if no overrides set.
 */
function loadChainPolicy(chainId) {
  const configPath = path.join(os.homedir(), ".epistery", "config.ini");
  if (!fs.existsSync(configPath)) return {};
  const data = ini.decode(fs.readFileSync(configPath, "utf8"));
  return data?.default?.rpc?.[String(chainId)]?.policy || {};
}

/**
 * Build legacy gasPrice overrides for JOC (81): apply the 30 gwei minimum
 * (JOC RPC enforces this), enforce the same ceiling as Polygon, and force
 * type=0 so hardhat doesn't construct an EIP-1559 typed tx — JOC doesn't
 * honor maxFeePerGas/maxPriorityFeePerGas and the tx will sit in mempool.
 */
async function jocDeployOverrides(provider, policy) {
  const fd = await provider.getFeeData();
  const minPrice = hre.ethers.utils.parseUnits(
    String(policy.minGasPriceGwei ?? 30), "gwei"
  );
  const networkPrice = fd.gasPrice || minPrice;
  const gasPrice = networkPrice.gt(minPrice) ? networkPrice : minPrice;

  const ceiling = hre.ethers.utils.parseUnits(
    String(policy.maxGasPriceGwei ?? 1000), "gwei"
  );
  if (gasPrice.gt(ceiling)) {
    throw new Error(
      `Aborting deploy: JOC gas price ${hre.ethers.utils.formatUnits(gasPrice, "gwei")} gwei ` +
      `exceeds cap ${hre.ethers.utils.formatUnits(ceiling, "gwei")} gwei.`
    );
  }
  return { gasPrice, type: 0 };
}

/**
 * Build EIP-1559 overrides for Polygon (137) and Amoy (80002): apply the
 * 25 gwei priority floor, then enforce a configurable ceiling so a base-fee
 * spike or RPC misreport can't drain the wallet on a single deploy.
 */
async function polygonDeployOverrides(provider, policy) {
  const fd = await provider.getFeeData();
  const minPriority = hre.ethers.utils.parseUnits(
    String(policy.minPriorityFeeGwei ?? 25), "gwei"
  );
  const networkPriority = fd.maxPriorityFeePerGas || minPriority;
  const maxPriorityFeePerGas = networkPriority.gt(minPriority) ? networkPriority : minPriority;

  const multiplier = policy.maxFeeMultiplier ?? 2;
  const minMaxFee = maxPriorityFeePerGas.mul(multiplier);
  const networkMax = fd.maxFeePerGas || minMaxFee;
  const maxFeePerGas = networkMax.gt(minMaxFee) ? networkMax : minMaxFee;

  const ceiling = hre.ethers.utils.parseUnits(
    String(policy.maxFeePerGasGwei ?? 1000), "gwei"
  );
  if (maxFeePerGas.gt(ceiling)) {
    throw new Error(
      `Aborting deploy: network fee ${hre.ethers.utils.formatUnits(maxFeePerGas, "gwei")} gwei ` +
      `exceeds cap ${hre.ethers.utils.formatUnits(ceiling, "gwei")} gwei. ` +
      `Raise [default.rpc.<chainId>.policy] maxFeePerGasGwei in ~/.epistery/config.ini if intentional.`
    );
  }
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/**
 * Deploy Agent contract script
 *
 * Usage:
 *   npx hardhat run scripts/deploy-agent.js --network localhost
 *   npx hardhat run scripts/deploy-agent.js --network sepolia
 *   npx hardhat run scripts/deploy-agent.js --network polygon
 *
 * Environment variables (optional):
 *   DOMAIN - Domain name for the contract (default: localhost)
 *   SPONSOR - Sponsor address (default: deployer address)
 *   UPDATE_CONFIG - Update config.json with new contract address (default: true)
 */

async function main() {
  // Get deployment parameters from environment or use defaults
  const domain = process.env.DOMAIN || "localhost";
  const updateConfig = process.env.UPDATE_CONFIG !== "false";

  console.log("Deploying Agent contract...");
  console.log("Network:", hre.network.name);
  console.log("Domain:", domain);

  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get account balance
  const balance = await deployer.getBalance();
  console.log("Account balance:", hre.ethers.utils.formatEther(balance), hre.network.name === 'polygon' ? 'POL' : 'ETH');

  // Sponsor defaults to deployer if not specified
  const sponsor = process.env.SPONSOR || deployer.address;
  console.log("Sponsor address:", sponsor);

  // Deploy the Agent contract with constructor parameters
  console.log("\nDeploying Agent contract...");
  const Agent = await hre.ethers.getContractFactory("Agent");

  // Apply fee cap and per-chain tx-type. Without this, hardhat builds an
  // EIP-1559 tx by default — fine for Polygon, but JOC rejects/drops those
  // because it only honors legacy gasPrice.
  const chainId = hre.network.config.chainId;
  let overrides = {};
  if (chainId === 137 || chainId === 80002) {
    const policy = loadChainPolicy(chainId);
    overrides = await polygonDeployOverrides(deployer.provider, policy);
    console.log(
      "Gas overrides (EIP-1559): maxFeePerGas=" +
      hre.ethers.utils.formatUnits(overrides.maxFeePerGas, "gwei") + " gwei, " +
      "maxPriorityFeePerGas=" +
      hre.ethers.utils.formatUnits(overrides.maxPriorityFeePerGas, "gwei") + " gwei"
    );
  } else if (chainId === 81) {
    const policy = loadChainPolicy(chainId);
    overrides = await jocDeployOverrides(deployer.provider, policy);
    console.log(
      "Gas overrides (legacy): gasPrice=" +
      hre.ethers.utils.formatUnits(overrides.gasPrice, "gwei") + " gwei"
    );
  }

  const agent = await Agent.deploy(domain, sponsor, overrides);

  await agent.deployed();
  const contractAddress = agent.address;

  console.log("\n✅ Agent contract deployed successfully!");
  console.log("Contract address:", contractAddress);
  console.log("Transaction hash:", agent.deployTransaction.hash);
  console.log("Domain:", await agent.domain());
  console.log("Sponsor:", await agent.sponsor());
  console.log("Version:", await agent.VERSION());

  // Update config.json if requested
  if (updateConfig) {
    try {
      const configPath = path.join(__dirname, "..", "..", ".epistery", "config.json");
      let config = {};

      // Read existing config if it exists
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configData);
      }

      // Ensure domain path exists
      if (!config[domain]) {
        config[domain] = {};
      }

      // Update contract address for this domain
      config[domain].contract_address = contractAddress;
      config[domain].updated_at = new Date().toISOString();

      // Save config
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      console.log("\n✅ Updated config.json:");
      console.log(`   ${domain}.contract_address = ${contractAddress}`);
    } catch (error) {
      console.error("\n⚠️  Failed to update config.json:", error.message);
      console.log("You will need to manually update the configuration.");
    }
  }

  console.log("\n📝 Next steps:");
  console.log("1. Verify the contract address is correct");
  console.log("2. Test the contract with basic operations");
  console.log("3. If this is a production deployment, verify the contract on the block explorer");

  return {
    address: contractAddress,
    domain: domain,
    sponsor: sponsor,
    network: hre.network.name
  };
}

// Only run main if this script is executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

// Export for use as a module
module.exports = { deployAgent: main };