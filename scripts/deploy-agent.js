const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

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
  const agent = await Agent.deploy(domain, sponsor);

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
      config[domain].agent_contract_address = contractAddress;
      config[domain].updated_at = new Date().toISOString();

      // Save config
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      console.log("\n✅ Updated config.json:");
      console.log(`   ${domain}.agent_contract_address = ${contractAddress}`);
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