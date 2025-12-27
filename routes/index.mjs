import express from "express";

// Import all route modules
import statusRoutes from "./status.mjs";
import authRoutes from "./auth.mjs";
import connectRoutes from "./connect.mjs";
import dataRoutes from "./data.mjs";
import approvalRoutes from "./approval.mjs";
import identityRoutes from "./identity.mjs";
import domainRoutes from "./domain.mjs";
import notabotRoutes from "./notabot.mjs";
import listRoutes from "./list.mjs";
import contractRoutes from "./contract.mjs";
import whitelistRoutes from "./whitelist/index.mjs";

/**
 * Creates and configures all Epistery routes
 *
 * Route structure:
 *   /                     - Status (JSON/HTML)
 *   /status               - Status page (HTML)
 *   /lib/:module          - Client library files
 *   /artifacts/:file      - Contract artifacts
 *   /connect              - Key exchange
 *   /create               - Create wallet
 *   /auth/*               - Authentication & domain claiming
 *   /data/*               - Data read/write/ownership
 *   /approval/*           - Approval system
 *   /identity/*           - Identity contract management
 *   /domain/*             - Domain initialization
 *   /notabot/*            - Notabot scoring
 *   /lists                - Get all lists
 *   /list                 - Get specific list
 *   /list/check/:address  - Check list membership
 *   /contract/*           - Contract version info
 *   /whitelist/*          - Whitelist management (admin, check, add, remove, etc.)
 *
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function createRoutes(epistery) {
  const router = express.Router();

  // Status routes (/, /status, /lib/:module, /artifacts/:contractFile)
  router.use(statusRoutes(epistery));

  // Connect routes (/connect, /create)
  router.use(connectRoutes(epistery));

  // Auth routes (/auth/*)
  router.use("/auth", authRoutes(epistery));

  // Data routes (/data/*)
  router.use("/data", dataRoutes(epistery));

  // Approval routes (/approval/*)
  router.use("/approval", approvalRoutes(epistery));

  // Identity routes (/identity/*)
  router.use("/identity", identityRoutes(epistery));

  // Domain routes (/domain/*)
  router.use("/domain", domainRoutes(epistery));

  // Notabot routes (/notabot/*)
  router.use("/notabot", notabotRoutes(epistery));

  // List routes (/lists, /list, /list/check/:address)
  router.use(listRoutes(epistery));

  // Contract routes (/contract/*)
  router.use("/contract", contractRoutes(epistery));

  // Whitelist routes (/whitelist/*)
  router.use("/whitelist", whitelistRoutes(epistery));

  return router;
}
