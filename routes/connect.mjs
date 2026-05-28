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

  // Session check - returns current identity from cookie (via auth middleware)
  router.get("/connect", (req, res) => {
    if (req.episteryClient) {
      const { address, name } = req.episteryClient;
      return res.json(name ? { address, name } : { address });
    }
    res.json({});
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

      // If the client presents a contract-backed identity (Tier 2), verify
      // on-chain that the signing rivet is actually one of the contract's
      // authorized rivets. This is what closes the cross-host trust loop —
      // the witness can claim any contract address, but the chain is truth.
      //
      // Provider: use the host's domain RPC. v0 assumes the IdentityContract
      // lives on the same chain as the host. Cross-chain identity is a
      // future concern.
      let verifiedContractAddress = null;
      const claimedContract = data.contractAddress || data.identityAddress;
      if (claimedContract) {
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
            claimedContract,
            IDENTITY_AUTHORIZED_ABI,
            provider,
          );
          const isAuth = await identity.isAuthorized(data.clientAddress);
          if (!isAuth) {
            return res.status(401).json({
              error:
                "Identity contract does not authorize this rivet (isAuthorized returned false)",
            });
          }
          verifiedContractAddress = claimedContract;
        } catch (e) {
          console.error("[connect] Identity contract verification failed:", e.message);
          return res.status(401).json({
            error: `Identity contract verification failed: ${e.message}`,
          });
        }
      }

      const clientInfo = {
        // For verified contract sessions, present the contract as the
        // canonical identity. The rivet remains accessible as signerAddress.
        address: verifiedContractAddress || data.clientAddress,
        signerAddress: data.clientAddress,
        contractAddress: verifiedContractAddress,
        publicKey: data.clientPublicKey,
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

      // Create session cookie. Rivet address always recorded; contract
      // address only when we just verified it on-chain. Downstream middleware
      // (index.mjs) surfaces contractAddress as req.episteryClient.address
      // when present.
      const sessionData = {
        rivetAddress: data.clientAddress,
        contractAddress: verifiedContractAddress || null,
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
