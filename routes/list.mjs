import express from "express";

/**
 * List routes - get lists, check list membership
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function listRoutes(epistery) {
  const router = express.Router();

  // Get all lists for the domain
  router.get("/lists", async (req, res) => {
    try {
      const lists = await epistery.getLists();
      res.json({
        domain: epistery.domainName,
        owner: epistery.domain.wallet.address,
        lists: lists,
        count: lists.length,
      });
    } catch (error) {
      console.error("Get lists error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific list by name (query param: ?list=example.com::admin)
  router.get("/list", async (req, res) => {
    try {
      const listName = req.query.list;
      if (!listName) {
        return res
          .status(400)
          .json({ error: "List name is required (use ?list=name)" });
      }

      const list = await epistery.getList(listName);
      res.json({
        domain: epistery.domainName,
        owner: epistery.domain.wallet.address,
        listName: listName,
        list: list,
        count: list.length,
      });
    } catch (error) {
      console.error("Get list error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if address is on a specific list (query param: ?list=example.com::admin)
  router.get("/list/check/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const listName = req.query.list;
      if (!listName) {
        return res
          .status(400)
          .json({ error: "List name is required (use ?list=name)" });
      }

      const isListed = await epistery.isListed(address, listName);
      res.json({
        address: address,
        listName: listName,
        isListed: isListed,
        domain: epistery.domainName,
      });
    } catch (error) {
      console.error("Check list error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
