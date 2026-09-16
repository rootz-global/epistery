import express from "express";
import { createRequire } from "module";
import { Utils } from "../dist/utils/Utils.js";
import { issueDomainAttachment } from "../client/domain-attachment.mjs";

const require = createRequire(import.meta.url);
const ethers = require("ethers");

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
      await config.setPath(domain);

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
      await config.save();

      res.json({
        status: "success",
        message: "Domain initialized with custom provider",
      });
    } catch (error) {
      console.error("Domain initialization error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Attach an identity to this domain — the domain's signature on a contract.
  //
  // An identity records this on its own contract, where it becomes a proof rather
  // than an assertion: a reader recovers the signer and checks it against the
  // address this domain publishes about itself. See client/domain-attachment.mjs.
  //
  // WHAT IS SIGNED IS NOT WHAT WAS ASKED FOR. The contract comes from the
  // AUTHENTICATED caller — the identity the package already verified on chain at
  // key exchange (isAuthorized) — never from the request body. A domain that signs
  // whatever address it is handed has signed a statement it cannot stand behind,
  // and there would be no point checking a signature that means nothing.
  //
  // Fails closed on host mismatch, exactly as the origin certificate does: the
  // loaded domain config is one instance mutated per request, so a concurrent
  // request for another hostname can leave the two out of step, and an attachment
  // naming the wrong domain is worse than no attachment.
  router.post("/attach", async (req, res) => {
    const client = req.episteryClient;
    const contract = client?.contractAddress;
    if (!contract) {
      return res.status(401).json({
        error:
          "no proven identity on this request — connect with a contract this device is authorized on, then ask again",
      });
    }

    const host = req.hostname || req.headers.host?.split(":")[0] || null;
    if (!host) return res.status(400).json({ error: "no host on the request" });
    if (epistery.domainName !== host) {
      console.warn(
        `[domain/attach] domain config is "${epistery.domainName}" but this request is for "${host}" — refusing to sign`,
      );
      return res.status(503).json({ error: "domain configuration is not loaded for this host — try again" });
    }

    const serverWallet = epistery.domain;
    if (!serverWallet?.wallet?.mnemonic) {
      return res.status(500).json({ error: `no domain wallet for "${host}" — nothing can be attached to it` });
    }

    try {
      const attachment = await issueDomainAttachment(
        { contract, domain: host },
        ethers.Wallet.fromMnemonic(serverWallet.wallet.mnemonic),
      );
      // The identity records this itself: the write is its own rivet's, on its own
      // contract. The domain signs and hands it back — it never writes for anyone.
      res.json({ attachment });
    } catch (error) {
      console.error("[domain/attach] issue failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
