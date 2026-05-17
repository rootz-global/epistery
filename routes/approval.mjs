import express from "express";
import { Epistery } from "../dist/epistery.js";

/**
 * Approval routes - create, get, and handle approval requests
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function approvalRoutes(epistery) {
  const router = express.Router();

  // Legacy server-side signing endpoints

  router.post("/create", async (req, res) => {
    try {
      const body = req.body;
      const {
        clientWalletInfo,
        approverAddress,
        fileName,
        fileHash,
        domain,
      } = body;

      if (
        !clientWalletInfo ||
        !approverAddress ||
        !fileName ||
        !fileHash ||
        !domain
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: clientWalletInfo, approverAddress, fileName, fileHash, domain",
        });
      }

      const result = await Epistery.createApproval(
        clientWalletInfo,
        approverAddress,
        fileName,
        fileHash,
        domain,
      );
      if (!result) {
        return res.status(500).json({ error: "Create approval failed" });
      }

      res.json(result);
    } catch (error) {
      console.error("Create approval error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/get", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo, approverAddress, requestorAddress } = body;

      if (!clientWalletInfo || !approverAddress || !requestorAddress) {
        return res.status(400).json({
          error:
            "Missing required fields: clientWalletInfo, approverAddress, requestorAddress",
        });
      }

      const result = await Epistery.getApprovals(
        clientWalletInfo,
        approverAddress,
        requestorAddress,
      );

      res.json({
        approverAddress: approverAddress,
        requestorAddress: requestorAddress,
        approvals: result,
        count: result.length,
      });
    } catch (error) {
      console.error("Get approvals error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/get-all", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo, approverAddress } = body;

      if (!clientWalletInfo || !approverAddress) {
        return res.status(400).json({
          error: "Missing required fields: clientWalletInfo, approverAddress",
        });
      }

      const result = await Epistery.getAllApprovalsForApprover(
        clientWalletInfo,
        approverAddress,
      );

      res.json({
        approverAddress: approverAddress,
        approvals: result,
        count: result.length,
      });
    } catch (error) {
      console.error("Get all approvals error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/get-all-requestor", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo, requestorAddress } = body;

      if (!clientWalletInfo || !requestorAddress) {
        return res.status(400).json({
          error:
            "Missing required fields: clientWalletInfo, requestorAddress",
        });
      }

      const result = await Epistery.getAllApprovalsForRequestor(
        clientWalletInfo,
        requestorAddress,
      );

      res.json({
        requestorAddress: requestorAddress,
        approvals: result,
        count: result.length,
      });
    } catch (error) {
      console.error("Get all approvals for requestor error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/handle", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo, requestorAddress, fileName, approved } = body;

      if (
        !clientWalletInfo ||
        !requestorAddress ||
        !fileName ||
        approved === undefined
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: clientWalletInfo, requestorAddress, fileName, approved",
        });
      }

      const result = await Epistery.handleApproval(
        clientWalletInfo,
        requestorAddress,
        fileName,
        approved,
      );
      if (!result) {
        return res.status(500).json({ error: "Handle approval failed" });
      }

      res.json(result);
    } catch (error) {
      console.error("Handle approval error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Client-side signing endpoints (prepare transactions)

  /**
   * POST /approval/prepare-create
   *
   * Prepares an unsigned transaction for creating an approval request.
   */
  router.post("/prepare-create", async (req, res) => {
    try {
      const { clientAddress, approverAddress, fileName, fileHash, domain } =
        req.body;

      if (
        !clientAddress ||
        !approverAddress ||
        !fileName ||
        !fileHash ||
        !domain
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: clientAddress, approverAddress, fileName, fileHash, domain",
        });
      }

      const result = await Epistery.prepareCreateApproval(
        clientAddress,
        approverAddress,
        fileName,
        fileHash,
        domain,
      );
      res.json(result);
    } catch (error) {
      console.error("Prepare create approval error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /approval/prepare-handle
   *
   * Prepares an unsigned transaction for handling an approval request.
   */
  router.post("/prepare-handle", async (req, res) => {
    try {
      const {
        approverAddress,
        requestorAddress,
        fileName,
        approved,
        domain,
      } = req.body;

      if (
        !approverAddress ||
        !requestorAddress ||
        !fileName ||
        approved === undefined ||
        !domain
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: approverAddress, requestorAddress, fileName, approved, domain",
        });
      }

      const result = await Epistery.prepareHandleApproval(
        approverAddress,
        requestorAddress,
        fileName,
        approved,
        domain,
      );
      res.json(result);
    } catch (error) {
      console.error("Prepare handle approval error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
