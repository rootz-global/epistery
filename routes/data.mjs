import express from "express";
import { Epistery } from "../dist/epistery.js";

/**
 * Data routes - read, write, ownership transfer, and client-side signing support
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function dataRoutes(epistery) {
  const router = express.Router();

  // Legacy server-side signing endpoints

  router.post("/write", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo, data } = body;

      if (!clientWalletInfo || !data) {
        return res
          .status(400)
          .json({ error: "Missing client wallet or data" });
      }

      const result = await Epistery.write(clientWalletInfo, data);
      if (!result) {
        return res.status(500).json({ error: "Write operation failed" });
      }

      res.json(result);
    } catch (error) {
      console.error("Write error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/read", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo } = body;

      if (!clientWalletInfo) {
        return res.status(400).json({ error: "Missing client wallet" });
      }

      const result = await Epistery.read(clientWalletInfo);
      if (!result) {
        return res.status(204);
      }

      res.json(result);
    } catch (error) {
      console.error("Read error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/ownership", async (req, res) => {
    try {
      const body = req.body;
      const { clientWalletInfo, futureOwnerWalletAddress, contractAddress } =
        body;

      if (!clientWalletInfo || !futureOwnerWalletAddress) {
        return res.status(400).json({
          error: "Missing either client wallet or future owner address.",
        });
      }

      const result = await Epistery.transferOwnership(
        clientWalletInfo,
        futureOwnerWalletAddress,
        contractAddress,
      );
      if (!result) {
        return res.status(500).json({ error: "Transfer ownership failed" });
      }

      res.json(result);
    } catch (error) {
      console.error("Transfer ownership error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // MESSAGING ENDPOINTS
  // Direct messages between addresses
  // ============================================================================

  /**
   * POST /data/message
   *
   * Send a direct message to another address.
   * Creates a RivetItem in the conversation between sender and recipient.
   */
  router.post("/message", async (req, res) => {
    try {
      const { clientWalletInfo, to, data, metadata } = req.body;

      if (!clientWalletInfo || !to || !data) {
        return res.status(400).json({
          error: "Missing required fields: clientWalletInfo, to, data",
        });
      }

      const result = await Epistery.sendMessage(
        clientWalletInfo,
        to,
        data,
        metadata || "",
      );

      res.json(result);
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /data/conversation
   *
   * Get all messages in a conversation between the caller and another party.
   * Fetches IPFS content for each message.
   */
  router.post("/conversation", async (req, res) => {
    try {
      const { clientWalletInfo, otherParty } = req.body;

      if (!clientWalletInfo || !otherParty) {
        return res.status(400).json({
          error: "Missing required fields: clientWalletInfo, otherParty",
        });
      }

      const result = await Epistery.getConversation(clientWalletInfo, otherParty);
      res.json(result);
    } catch (error) {
      console.error("Get conversation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /data/conversations
   *
   * Get all conversation IDs for a user.
   */
  router.post("/conversations", async (req, res) => {
    try {
      const { clientWalletInfo } = req.body;

      if (!clientWalletInfo) {
        return res.status(400).json({
          error: "Missing required field: clientWalletInfo",
        });
      }

      const conversationIds = await Epistery.getUserConversations(clientWalletInfo);
      res.json({
        address: clientWalletInfo.address,
        conversations: conversationIds,
        count: conversationIds.length,
      });
    } catch (error) {
      console.error("Get conversations error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /data/conversation-id
   *
   * Get the deterministic conversation ID for two addresses.
   * Pure function, no blockchain access needed.
   */
  router.get("/conversation-id", (req, res) => {
    try {
      const { addr1, addr2 } = req.query;

      if (!addr1 || !addr2) {
        return res.status(400).json({
          error: "Missing required query params: addr1, addr2",
        });
      }

      const conversationId = Epistery.getConversationId(addr1, addr2);
      res.json({
        addr1,
        addr2,
        conversationId,
      });
    } catch (error) {
      console.error("Get conversation ID error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // POST ENDPOINTS
  // Posts on boards (user profiles)
  // ============================================================================

  /**
   * POST /data/post
   *
   * Create a post on a board.
   * Creates a RivetItem on the specified board.
   */
  router.post("/post", async (req, res) => {
    try {
      const { clientWalletInfo, board, data, visibility, metadata } = req.body;

      if (!clientWalletInfo || !board || !data) {
        return res.status(400).json({
          error: "Missing required fields: clientWalletInfo, board, data",
        });
      }

      // Convert visibility string to enum value (default: public = 0)
      let visibilityValue = 0; // Public
      if (visibility === "private" || visibility === 1) {
        visibilityValue = 1; // Private
      }

      const result = await Epistery.createPost(
        clientWalletInfo,
        board,
        data,
        visibilityValue,
        metadata || "",
      );

      res.json(result);
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /data/posts
   *
   * Get all posts from a board.
   * Supports pagination with offset and limit.
   * Visibility filtering is handled by the contract based on caller.
   */
  router.post("/posts", async (req, res) => {
    try {
      const { clientWalletInfo, board, offset, limit } = req.body;

      if (!clientWalletInfo || !board) {
        return res.status(400).json({
          error: "Missing required fields: clientWalletInfo, board",
        });
      }

      const result = await Epistery.getPosts(
        clientWalletInfo,
        board,
        offset,
        limit,
      );

      res.json(result);
    } catch (error) {
      console.error("Get posts error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /data/public-keys/:address
   *
   * Get all public keys for an address.
   */
  router.get("/public-keys/:address", async (req, res) => {
    try {
      const { address } = req.params;

      if (!address) {
        return res.status(400).json({
          error: "Missing address parameter",
        });
      }

      const publicKeys = await Epistery.getPublicKeys(address);
      res.json({
        address,
        publicKeys,
        count: publicKeys.length,
      });
    } catch (error) {
      console.error("Get public keys error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Client-side signing endpoints (prepare transactions)

  /**
   * POST /data/prepare-write
   *
   * Prepares an unsigned transaction for writing data.
   * Server handles IPFS upload, gas estimation, and client funding.
   * Returns unsigned transaction for client to sign.
   */
  router.post("/prepare-write", async (req, res) => {
    try {
      const { clientAddress, publicKey, data } = req.body;

      if (!clientAddress || !publicKey || !data) {
        return res.status(400).json({
          error: "Missing required fields: clientAddress, publicKey, data",
        });
      }

      const result = await Epistery.prepareWrite(
        clientAddress,
        publicKey,
        data,
      );
      res.json(result);
    } catch (error) {
      console.error("Prepare write error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /data/prepare-transfer-ownership
   *
   * Prepares an unsigned transaction for transferring ownership.
   * Accepts optional contractAddress for IdentityContract transfers.
   */
  router.post("/prepare-transfer-ownership", async (req, res) => {
    try {
      const { clientAddress, futureOwnerAddress, contractAddress } = req.body;

      if (!clientAddress || !futureOwnerAddress) {
        return res.status(400).json({
          error: "Missing required fields: clientAddress, futureOwnerAddress",
        });
      }

      const result = await Epistery.prepareTransferOwnership(
        clientAddress,
        futureOwnerAddress,
        contractAddress,
      );
      res.json(result);
    } catch (error) {
      console.error("Prepare transfer ownership error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /data/submit-signed
   *
   * Submits a client-signed transaction to the blockchain.
   * This is a generic endpoint used by all write operations.
   *
   * The transaction is already signed and immutable.
   * Server just broadcasts it and returns the receipt.
   */
  router.post("/submit-signed", async (req, res) => {
    try {
      const { signedTransaction, operation, metadata } = req.body;

      if (!signedTransaction) {
        return res.status(400).json({
          error: "Missing required field: signedTransaction",
        });
      }

      const result =
        await Epistery.submitSignedTransaction(signedTransaction);

      // Merge metadata into response (e.g., ipfsHash for write operations)
      res.json({
        ...result,
        operation: operation,
        metadata: metadata,
      });
    } catch (error) {
      console.error("Submit signed transaction error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
