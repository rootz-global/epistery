const hre = require("hardhat");

async function main() {
  console.log("Deploying Agent contract to Sepolia...");

  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get account balance
  const balance = await deployer.getBalance();
  console.log("Account balance:", hre.ethers.utils.formatEther(balance), "ETH");

  // Deploy the Agent contract
  const Agent = await hre.ethers.getContractFactory("Agent");
  const agent = await Agent.deploy();

  await agent.deployed();

  console.log("\nAgent contract deployed successfully!");
  console.log("Contract address:", agent.address);
  console.log("Transaction hash:", agent.deployTransaction.hash);

  console.log("Update .env file with:");
  console.log(`   AGENT_CONTRACT_ADDRESS=${agent.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
