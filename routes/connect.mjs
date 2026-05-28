import express from "express";
import { createRequire } from "module";
import { Epistery } from "../dist/epistery.js";

const require = createRequire(import.meta.url);
const ethers = require("ethers");

// Subset of IdentityContract used to verify a rivet's membership claim.
// Both V2 and V3 IdentityContract expose isAuthorized(address).
const IDENTITY_AUTHORIZED_ABI = [
  "function isAuthorized(address) view returns (bool)",
];

/**
 * Connect routes - key exchange and wallet creation
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function connectRoutes(epistery) {
  const router = express.Router();

  // Session check — surface the three facts the middleware exposes, no more.
  // Witness compares its current identityAddress against this; matching means
  // the cookie already names us, so no re-handshake needed.
  router.get("/connect", (req, res) => {
    const c = req.episteryClient;
    if (!c) return res.json({});
    res.json({
      signerAddress: c.signerAddress,
      identityAddress: c.identityAddress,
      contractAddress: c.contractAddress,
      ...(c.name ? { name: c.name } : {}),
    });
  });

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

      // Contract claim — when present, ALWAYS verified on-chain. No "is
      // contract == signer? then skip" shortcut: the wire never overloads
      // a single field, so the verifier never has to guess what the client
      // meant. The chain is truth; we ask it directly.
      //
      // Provider: the host's domain RPC. v0 assumes the IdentityContract
      // lives on the same chain as the host. Cross-chain identity is a
      // future concern.
      let verifiedContractAddress = null;
      if (data.contractAddress) {
        try {
          const rpcUrl =
            serverWallet?.provider?.privateRpc ||
            serverWallet?.provider?.rpc ||
            process.env.CHAIN_RPC_URL;
          if (!rpcUrl) {
            return res.status(500).json({
              error: "No chain RPC configured to verify identity contract",
            });
          }
          const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
          const identity = new ethers.Contract(
            data.contractAddress,
            IDENTITY_AUTHORIZED_ABI,
            provider,
          );
          const isAuth = await identity.isAuthorized(data.signerAddress);
          if (!isAuth) {
            return res.status(401).json({
              error:
                "Identity contract does not authorize this signer (isAuthorized returned false)",
            });
          }
          verifiedContractAddress = data.contractAddress;
        } catch (e) {
          console.error("[connect] Identity contract verification failed:", e.message);
          return res.status(401).json({
            error: `Identity contract verification failed: ${e.message}`,
          });
        }
      }

      // Build the three-fact view we expose to downstream middleware AND
      // hand to any caller-supplied authentication() hook. identityAddress is
      // derived here; it never appears on the wire and is not stored.
      const clientInfo = {
        signerAddress: data.signerAddress,
        contractAddress: verifiedContractAddress,
        identityAddress: verifiedContractAddress || data.signerAddress,
        publicKey: data.signerPublicKey,
      };
      // Naming is a relay service (per-domain contract name + nicknames), not
      // epistery's concern — no name lookup here.
      if (epistery.options.authentication) {
        clientInfo.profile = await epistery.options.authentication.call(
          epistery.options.authentication,
          clientInfo,
        );
        clientInfo.authenticated = !!clientInfo.profile;
      }
      req.episteryClient = clientInfo;

      // Cookie stores facts only — signer + (verified) contract. identityAddress
      // is re-derived every read; persisting it would just be a place for the
      // two to drift apart.
      const sessionData = {
        signerAddress: data.signerAddress,
        contractAddress: verifiedContractAddress,
        publicKey: data.signerPublicKey,
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
