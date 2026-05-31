import express from "express";

// Import all route modules
import statusRoutes from "./status.mjs";
import authRoutes from "./auth.mjs";
import connectRoutes from "./connect.mjs";
import identityRoutes from "./identity.mjs";
import domainRoutes from "./domain.mjs";
import fidoRoutes from "./fido.mjs";

/**
 * Creates and configures all Epistery routes
 *
 * Route structure:
 *   /                     - Status (JSON)
 *   /lib/:module          - Client library files
 *   /artifacts/:file      - Contract artifacts
 *   /connect              - Key exchange (binds a rivet to its IdentityContract)
 *   /create               - Create wallet
 *   /auth/*               - Authentication & domain claiming
 *   /identity/*           - Identity contract binding (prepare-add-rivet)
 *   /domain/*             - Domain initialization
 *   /fido/*               - FIDO PRF-wrapped rivet key blob storage
 *
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function createRoutes(epistery) {
  const router = express.Router();

  // Status routes (/, /lib/:module, /artifacts/:contractFile)
  router.use(statusRoutes(epistery));

  // Connect routes (/connect, /create)
  router.use(connectRoutes(epistery));

  // Auth routes (/auth/*)
  router.use("/auth", authRoutes(epistery));

  // Identity routes (/identity/*)
  router.use("/identity", identityRoutes(epistery));

  // Domain routes (/domain/*)
  router.use("/domain", domainRoutes(epistery));

  // FIDO routes (/fido/blob — PRF-wrapped rivet private key storage)
  router.use("/fido", fidoRoutes(epistery));

  return router;
}