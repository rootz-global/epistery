import express from "express";
import { Epistery } from "../dist/epistery.js";

/**
 * Connect routes - key exchange and wallet creation
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function connectRoutes(epistery) {
  const router = express.Router();

  // Key exchange endpoint - handles POST requests for key exchange
  router.post("/connect", async (req, res) => {
    try {
      const data = req.body;
      if (!data && Object.keys(data).length <= 0) data = req.body;

      const serverWallet = epistery.domain;

      if (!serverWallet?.wallet) {
        return res.status(500).json({ error: "Server wallet not found" });
      }

      // Handle key exchange request
      const keyExchangeResponse = await Epistery.handleKeyExchange(
        data,
        serverWallet.wallet,
      );

      if (!keyExchangeResponse) {
        return res.status(401).json({
          error: "Key exchange failed - invalid client credentials",
        });
      }
      const clientInfo = {
        address: data.clientAddress,
        publicKey: data.clientPublicKey,
      };
      if (epistery.options.authentication) {
        clientInfo.profile = await epistery.options.authentication.call(
          epistery.options.authentication,
          clientInfo,
        );
        clientInfo.authenticated = !!clientInfo.profile;
      }
      req.episteryClient = clientInfo;

      // Create session cookie with rivet identity
      const sessionData = {
        rivetAddress: data.clientAddress,
        publicKey: data.clientPublicKey,
        authenticated: clientInfo.authenticated || false,
        timestamp: new Date().toISOString(),
      };
      const sessionToken = Buffer.from(JSON.stringify(sessionData)).toString(
        "base64",
      );

      // Cookie must be strictly scoped to this specific domain
      // Each domain has its own server wallet and client rivets in IndexedDB
      // DO NOT set domain attribute - let browser use strict same-origin policy
      res.cookie("_epistery", sessionToken, {
        httpOnly: true,
        secure: req.secure || req.headers["x-forwarded-proto"] === "https",
        sameSite: "strict",
        path: "/",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      // Call onAuthenticated hook if provided
      if (epistery.options.onAuthenticated && clientInfo.authenticated) {
        await epistery.options.onAuthenticated(clientInfo, req, res);
      }

      res.json(
        Object.assign(keyExchangeResponse, {
          profile: clientInfo.profile,
          authenticated: clientInfo.authenticated,
        }),
      );
    } catch (error) {
      console.error("Key exchange error:", error);
      res
        .status(500)
        .json({ error: "Internal server error during key exchange" });
    }
  });

  router.get("/create", (req, res) => {
    const wallet = Epistery.createWallet();
    res.json({ wallet });
  });

  return router;
}
