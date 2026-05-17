import express from "express";

/**
 * Contract routes - version check and contract management
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function contractRoutes(epistery) {
  const router = express.Router();

  // Contract version check endpoint
  router.get("/version", async (req, res) => {
    try {
      const versionInfo = await epistery.checkContractVersion();
      res.json(versionInfo);
    } catch (error) {
      console.error("Check contract version error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
