import express from "express";
import { Utils } from "../dist/utils/Utils.js";

/**
 * Domain routes - initialize domain with custom provider
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function domainRoutes(epistery) {
  const router = express.Router();

  // Domain initialization endpoint - use to set up domain with custom provider
  router.post("/initialize", async (req, res) => {
    try {
      const body = req.body;
      const domain = req.hostname;
      const { provider } = body;

      if (!provider || !provider.name || !provider.chainId || !provider.rpc) {
        return res
          .status(400)
          .json({ error: "Invalid provider configuration" });
      }

      // Check if domain already exists
      const config = Utils.GetConfig();
      config.setPath(domain);

      let domainConfig = config.data;
      if (!domainConfig.domain) domainConfig.domain = domain;
      domainConfig.pending = true;
      if (!domainConfig.provider)
        domainConfig.provider = {
          chainId: provider.chainId,
          name: provider.name,
          rpc: provider.rpc,
        };

      // Save domain config with custom provider (marked as pending)
      config.save();

      res.json({
        status: "success",
        message: "Domain initialized with custom provider",
      });
    } catch (error) {
      console.error("Domain initialization error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
