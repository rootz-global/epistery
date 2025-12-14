import express from "express";
import { Epistery } from "../dist/epistery.js";

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

  return router;
}
