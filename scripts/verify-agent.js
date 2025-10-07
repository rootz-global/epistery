const hre = require("hardhat");
require('dotenv').config();

async function main() {
  const contractAddress = process.env.AGENT_CONTRACT_ADDRESS;

  if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
    console.error("AGENT_CONTRACT_ADDRESS missing from .env file");
    process.exit(1);
  }

  console.log("Verifying Agent contract on Sepolia Etherscan...");
  console.log("Contract address:", contractAddress);

  try {
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [],
    });

    console.log("Contract verified successfully!");
    console.log(`View on Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("Contract is already verified!");
      console.log(`View on Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);
    } else {
      console.error("Verification failed:", error.message);
      process.exit(1);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
