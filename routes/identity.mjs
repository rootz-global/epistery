import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Epistery } from "../dist/epistery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Identity routes - deploy identity contracts and add rivets
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function identityRoutes(epistery) {
  const router = express.Router();

  /**
   * POST /identity/prepare-deploy
   *
   * Prepares an unsigned transaction for deploying an IdentityContract.
   * Server handles gas estimation and client funding.
   * Returns unsigned deployment transaction for client to sign.
   */
  router.post("/prepare-deploy", async (req, res) => {
    try {
      const { clientAddress, domain } = req.body;

      if (!clientAddress || !domain) {
        return res.status(400).json({
          error: "Missing required fields: clientAddress, domain",
        });
      }

      const result = await Epistery.prepareDeployIdentityContract(
        clientAddress,
        domain,
      );
      res.json(result);
    } catch (error) {
      console.error("Prepare deploy identity contract error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /identity/prepare-add-rivet
   *
   * Prepares an unsigned transaction for adding a rivet to an IdentityContract.
   * Server handles gas estimation and client funding.
   * Returns unsigned transaction for client to sign.
   */
  router.post("/prepare-add-rivet", async (req, res) => {
    try {
      const {
        signerAddress,
        contractAddress,
        rivetAddressToAdd,
        rivetName,
        domain,
      } = req.body;

      if (
        !signerAddress ||
        !contractAddress ||
        !rivetAddressToAdd ||
        !rivetName ||
        !domain
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: signerAddress, contractAddress, rivetAddressToAdd, rivetName, domain",
        });
      }

      const result = await Epistery.prepareAddRivetToContract(
        signerAddress,
        contractAddress,
        rivetAddressToAdd,
        rivetName,
        domain,
      );
      res.json(result);
    } catch (error) {
      console.error("Prepare add rivet to contract error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /identity/check
   *
   * Read-only: checks whether a rivet address is authorized on an identity contract.
   * Used by the client's handleContractConnect() before linking a wallet.
   *
   * Query params:
   *   contract  - Identity contract address (0x...)
   *   rivet     - Rivet address to check (0x...)
   */
  router.get("/check", async (req, res) => {
    try {
      const { contract, rivet } = req.query;

      if (!contract || !rivet) {
        return res.status(400).json({ error: "Missing contract or rivet param" });
      }

      if (!/^0x[a-fA-F0-9]{40}$/.test(contract) || !/^0x[a-fA-F0-9]{40}$/.test(rivet)) {
        return res.status(400).json({ error: "Invalid address format" });
      }

      const { ethers } = await import("ethers");

      // Use the domain's RPC from config
      const rpc =
        epistery.domain?.provider?.rpc ||
        process.env.CHAIN_RPC_URL ||
        "https://polygon-bor-rpc.publicnode.com";

      const provider = new ethers.providers.JsonRpcProvider(rpc);

      // Load IdentityContract ABI
      const artifact = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "../artifacts/contracts/IdentityContract.sol/IdentityContract.json"),
          "utf8"
        )
      );

      const identityContract = new ethers.Contract(contract, artifact.abi, provider);
      const authorized = await identityContract.isAuthorized(rivet);

      res.json({ authorized, contract, rivet });
    } catch (error) {
      console.error("Identity check error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
