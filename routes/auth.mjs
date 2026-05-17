import express from "express";
import crypto from "crypto";
import dns from "dns";
import { promisify } from "util";

const resolveTxt = promisify(dns.resolveTxt);

/**
 * Authentication routes - domain claiming, DNS verification, admin checks
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function authRoutes(epistery) {
  const router = express.Router();

  /**
   * Check if there's a pending challenge for the domain
   */
  router.get("/account/claim", async (req, res) => {
    try {
      const domain = req.hostname;
      if (!domain) {
        return res
          .status(400)
          .json({ status: "error", message: "Domain not found" });
      }

      epistery.config.setPath(domain);

      if (epistery.config.data && epistery.config.data.verified) {
        return res
          .status(400)
          .json({ status: "error", message: "Domain already claimed" });
      }

      // Return existing challenge if one exists
      if (
        epistery.config.data &&
        epistery.config.data.pending &&
        epistery.config.data.challenge_token
      ) {
        return res.json({
          challenge_token: epistery.config.data.challenge_token,
          challenge_address: epistery.config.data.challenge_address,
        });
      }

      res.json(null);
    } catch (error) {
      console.error("Challenge check error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * Generate a challenge token for domain claiming
   */
  router.post("/account/claim", async (req, res) => {
    try {
      const domain = req.hostname;
      if (!domain) {
        return res
          .status(400)
          .json({ status: "error", message: "Domain not found" });
      }

      // Validate request origin
      const origin = req.get("origin") || req.get("referer");
      if (origin) {
        const originUrl = new URL(origin);
        if (originUrl.hostname !== domain) {
          return res.status(403).json({
            status: "error",
            message: "Request origin does not match domain",
          });
        }
      }

      const clientAddress = req.body.clientAddress;
      if (!clientAddress) {
        return res.status(400).json({
          status: "error",
          message: "Client address required in request body",
        });
      }

      const providerConfig = req.body.provider;
      if (
        !providerConfig ||
        !providerConfig.name ||
        !providerConfig.chainId ||
        !providerConfig.rpc
      ) {
        return res.status(400).json({
          status: "error",
          message: "Invalid provider configuration",
        });
      }

      epistery.config.setPath(domain);

      if (epistery.config.data && epistery.config.data.verified) {
        return res
          .status(400)
          .json({ status: "error", message: "Domain already claimed" });
      }

      // Return existing challenge if one already exists (idempotent)
      if (
        epistery.config.data &&
        epistery.config.data.pending &&
        epistery.config.data.challenge_token
      ) {
        return res.send(epistery.config.data.challenge_token);
      }

      const challengeToken = crypto.randomBytes(32).toString("hex");
      const normalizedClientAddress = clientAddress.toLowerCase();

      // Save to domain config
      epistery.config.data.pending = true;
      epistery.config.data.challenge_token = challengeToken;
      epistery.config.data.challenge_address = normalizedClientAddress;
      epistery.config.data.challenge_created = new Date().toISOString();
      epistery.config.data.challenge_requester_ip = req.ip;
      epistery.config.data.provider = providerConfig;

      epistery.config.save();
      console.log(
        `Domain claim initiated: ${domain} by ${normalizedClientAddress}`,
      );

      res.send(challengeToken);
    } catch (error) {
      console.error("Challenge generation error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * Verify domain ownership via DNS TXT record
   */
  router.get("/dns/claim", async (req, res) => {
    try {
      const domain = req.hostname;
      if (!domain) {
        return res
          .status(400)
          .json({ status: "error", message: "Domain not found" });
      }

      epistery.config.setPath(domain);

      if (!epistery.config.data.pending) {
        return res.status(400).json({
          status: "error",
          message: "No pending claim for this domain",
        });
      }

      const clientAddress = req.query.address;
      console.log(`[debug] Verification attempt for domain: ${domain}`);
      console.log(`[debug] Client address: ${clientAddress}`);
      console.log(
        `[debug] Stored challenge address: ${epistery.config.data.challenge_address}`,
      );

      if (!clientAddress) {
        return res
          .status(401)
          .json({ status: "error", message: "Client address not found" });
      }

      if (
        clientAddress.toLowerCase() !==
        epistery.config.data.challenge_address.toLowerCase()
      ) {
        console.log(
          `[debug] Address mismatch: stored=${epistery.config.data.challenge_address}, current=${clientAddress}`,
        );
        return res.status(403).json({
          status: "error",
          message: "Only the original requester can complete the claim",
        });
      }

      const records = await resolveTxt(domain);
      const txtRecord = records
        .flat()
        .find((record) => record === epistery.config.data.challenge_token);

      if (!txtRecord) {
        return res.status(400).json({
          status: "error",
          message: "DNS TXT record not found or incorrect",
        });
      }

      console.log(
        `[debug] Domain claim completed: ${domain} by ${clientAddress} from ${req.ip}`,
      );

      epistery.config.data.verified = true;
      epistery.config.data.admin_address = clientAddress.toLowerCase();
      epistery.config.data.claimed_at = new Date().toISOString();
      epistery.config.data.verified_from_ip = req.ip;
      delete epistery.config.data.pending;
      delete epistery.config.data.challenge_token;
      delete epistery.config.data.challenge_address;
      delete epistery.config.data.challenge_requester_ip;
      epistery.config.save();

      res.json({ status: "success", message: "Domain claimed successfully" });
    } catch (error) {
      console.error("Claim verification error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * Check if user is an administrator
   */
  router.post("/account/check-admin", async (req, res) => {
    try {
      const domain = req.hostname;
      const address = req.body.address;

      if (!address) {
        return res.json({ isAdmin: false });
      }

      epistery.config.setPath(domain);

      if (
        !epistery.config.data ||
        !epistery.config.data.verified ||
        !epistery.config.data.admin_address
      ) {
        return res.json({ isAdmin: false });
      }

      const isAdmin =
        address.toLowerCase() ===
        epistery.config.data.admin_address.toLowerCase();
      res.json({ isAdmin });
    } catch (error) {
      console.error("Admin check error:", error);
      res.json({ isAdmin: false });
    }
  });

  return router;
}
