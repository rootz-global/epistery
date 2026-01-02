import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Whitelist routes - comprehensive access control management
 *
 * Route structure:
 *   /check              - Check if current rivet is whitelisted
 *   /auth               - Establish session from rivet signature
 *   /lists              - Get all lists (admin only)
 *   /list               - Get specific list (admin only)
 *   /add                - Add member (admin only)
 *   /remove             - Remove member (admin only)
 *   /status             - Agent status
 *   /request-access     - Request whitelist access
 *   /pending-requests   - Get pending access requests (admin only)
 *   /handle-request     - Approve/deny access request (admin only)
 *   /widget             - Widget HTML
 *   /admin              - Admin page HTML
 *   /client.js          - Client script
 *   /icon.svg           - Icon
 *
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function whitelistRoutes(epistery) {
  const router = express.Router();

  // In-memory pending requests storage
  let pendingRequests = [];

  /**
   * Authentication middleware - runs on every request
   * Supports multiple authentication methods:
   * 1. Epistery client (from key exchange / _epistery cookie)
   * 2. Bot authentication (CLI/programmatic access)
   * 3. Session cookies
   */
  async function getAuthenticatedRivet(req) {
    // 1. Check epistery core session (req.episteryClient set by epistery middleware)
    if (req.episteryClient && req.episteryClient.address) {
      return {
        valid: true,
        rivetAddress: req.episteryClient.address,
        publicKey: req.episteryClient.publicKey,
        authenticated: req.episteryClient.authenticated,
        authType: "epistery",
      };
    }

    // 2. Check for Bot authentication (CLI/programmatic access)
    if (req.headers.authorization?.startsWith("Bot ")) {
      try {
        const authHeader = req.headers.authorization.substring(4);
        const decoded = Buffer.from(authHeader, "base64").toString("utf8");
        const payload = JSON.parse(decoded);

        const { address, signature, message } = payload;

        if (!address || !signature || !message) {
          return { valid: false, error: "Bot auth: Missing required fields" };
        }

        // Verify the signature using ethers
        const { ethers } = await import("ethers");
        const recoveredAddress = ethers.utils.verifyMessage(message, signature);

        if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
          return { valid: false, error: "Bot auth: Invalid signature" };
        }

        return {
          valid: true,
          rivetAddress: address,
          authType: "bot",
        };
      } catch (error) {
        console.error("[whitelist] Bot auth error:", error);
        return { valid: false, error: `Bot auth failed: ${error.message}` };
      }
    }

    // 3. Check epistery session cookie (_epistery)
    const episterySession = req.cookies?._epistery;
    if (episterySession) {
      try {
        const sessionData = JSON.parse(
          Buffer.from(episterySession, "base64").toString("utf8"),
        );
        if (sessionData && sessionData.rivetAddress) {
          return {
            valid: true,
            rivetAddress: sessionData.rivetAddress,
            authType: "epistery-session",
          };
        }
      } catch (e) {
        // Invalid session, continue
      }
    }

    // No authentication found
    return {
      valid: false,
      error:
        "Not authenticated - use Bot header, session cookie, or epistery key exchange",
    };
  }

  /**
   * Check if user is an admin
   * Checks epistery::admin list (admins for the epistery host system)
   * Falls back to contract sponsor if no admins exist
   */
  async function isAdmin(rivetAddress) {
    try {
      // Primary: Check if address is on the epistery::admin list
      const isOnAdminList = await epistery.isListed(
        rivetAddress,
        "epistery::admin",
      );

      if (isOnAdminList) {
        return true;
      }

      // Fallback: If no admins exist, check if user is the contract sponsor
      const sponsor = await epistery.getSponsor();
      const isSponsor =
        sponsor && rivetAddress.toLowerCase() === sponsor.toLowerCase();

      if (isSponsor) {
        return true;
      }

      return false;
    } catch (error) {
      console.error("[whitelist] Admin check error:", error);
      return false;
    }
  }

  // Authentication middleware for routes that need it
  router.use(async (req, res, next) => {
    try {
      const auth = await getAuthenticatedRivet(req);
      req.whitelistAuth = auth.valid ? auth : null;
      next();
    } catch (error) {
      console.error("[whitelist] Auth middleware error:", error);
      req.whitelistAuth = null;
      next();
    }
  });

  // Serve icon
  router.get("/icon.svg", (req, res) => {
    const iconPath = path.join(__dirname, "client/icon.svg");
    if (!existsSync(iconPath)) {
      return res.status(404).send("Icon not found");
    }
    res.set("Content-Type", "image/svg+xml");
    res.sendFile(iconPath);
  });

  // Serve widget (for agent box)
  router.get("/widget", (req, res) => {
    const widgetPath = path.join(__dirname, "client/widget.html");
    if (!existsSync(widgetPath)) {
      return res.status(404).send("Widget not found");
    }
    res.sendFile(widgetPath);
  });

  // Serve admin page
  router.get("/admin", (req, res) => {
    const adminPath = path.join(__dirname, "client/admin.html");
    if (!existsSync(adminPath)) {
      return res.status(404).send("Admin page not found");
    }
    res.sendFile(adminPath);
  });

  // Serve client.js for publishers
  router.get("/client.js", (req, res) => {
    const clientPath = path.join(__dirname, "client/client.js");
    if (!existsSync(clientPath)) {
      return res.status(404).send("Client script not found");
    }
    res.set("Content-Type", "text/javascript");
    res.sendFile(clientPath);
  });

  // Check endpoint - verify whitelist status
  // Query params: ?list=domain::wiki.rootz.global
  router.get("/check", async (req, res) => {
    try {
      const auth = await getAuthenticatedRivet(req);

      if (!auth.valid) {
        return res.status(401).json({
          allowed: false,
          error: auth.error,
        });
      }

      // Get list name from query params (defaults to domain-based list)
      const listName =
        req.query.list || `domain::${req.hostname || epistery.domainName}`;

      // Development mode: allow all addresses for localhost
      const isLocalhost =
        req.hostname === "localhost" || req.hostname === "127.0.0.1";

      if (isLocalhost) {
        return res.json({
          allowed: true,
          address: auth.rivetAddress,
          domain: epistery.domainName,
          listName: listName,
          devMode: true,
        });
      }

      // Check if rivet is whitelisted
      const isListed = await epistery.isListed(auth.rivetAddress, listName);

      res.json({
        allowed: isListed,
        address: auth.rivetAddress,
        domain: epistery.domainName,
        listName: listName,
      });
    } catch (error) {
      console.error("[whitelist] Check error:", error);

      // Development mode fallback
      const isLocalhost =
        req.hostname === "localhost" || req.hostname === "127.0.0.1";
      if (
        isLocalhost &&
        error.message.includes("Agent contract address not configured")
      ) {
        const auth = await getAuthenticatedRivet(req);
        const listName =
          req.query.list || `domain::${req.hostname || epistery.domainName}`;

        return res.json({
          allowed: true,
          address: auth.rivetAddress,
          domain: epistery.domainName,
          listName: listName,
          devMode: true,
          note: "Contract not configured - using dev mode",
        });
      }

      res.status(500).json({
        allowed: false,
        error: error.message,
      });
    }
  });

  // Lists by address endpoint - get all whitelists an address belongs to
  // Query params: ?address=0x...
  router.get("/listsByAddress", async (req, res) => {
    try {
      const { address } = req.query;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({
          error: "Invalid or missing address parameter",
        });
      }

      // Get memberships from contract
      const memberships = await epistery.getListsForMember(address);

      res.json({
        client: {
          address: address,
          whitelists: memberships.map((m) => m.listName),
          memberships: memberships.map((m) => ({
            listName: m.listName,
            role: m.role,
            roleName: getRoleName(m.role),
            addedAt: m.addedAt,
          })),
          whitelistedBy: epistery.domain?.wallet?.address || null,
        },
      });
    } catch (error) {
      console.error("[whitelist] Lists by address error:", error);
      res.status(500).json({
        error: error.message,
      });
    }
  });

  // Helper function to get role name
  function getRoleName(role) {
    const roleNames = {
      0: "none",
      1: "read",
      2: "edit",
      3: "admin",
      4: "owner",
    };
    return roleNames[role] || "unknown";
  }

  // Auth endpoint - establish session from rivet signature
  router.post("/auth", express.json(), async (req, res) => {
    try {
      const { address, signature, message } = req.body;

      if (!address || !signature || !message) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: address, signature, message",
        });
      }

      // Verify the signature
      const { ethers } = await import("ethers");
      let recoveredAddress;
      try {
        recoveredAddress = ethers.utils.verifyMessage(message, signature);
      } catch (sigError) {
        return res.status(401).json({
          success: false,
          error: "Invalid signature",
        });
      }

      if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
        return res.status(401).json({
          success: false,
          error: "Invalid signature",
        });
      }

      // Create session cookie with authenticated address
      const sessionData = {
        rivetAddress: address,
        authenticated: true,
        timestamp: Date.now(),
      };
      const sessionToken = Buffer.from(JSON.stringify(sessionData)).toString(
        "base64",
      );

      res.cookie("_epistery", sessionToken, {
        httpOnly: true,
        secure: req.secure || req.headers["x-forwarded-proto"] === "https",
        sameSite: "strict",
        path: "/",
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      res.json({
        success: true,
        address: address,
        message: "Session established",
      });
    } catch (error) {
      console.error("[whitelist] Auth error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Lists endpoint - get all lists (admin only)
  router.get("/lists", async (req, res) => {
    try {
      if (!req.whitelistAuth) {
        return res.status(401).json({
          error: "Not authenticated",
        });
      }

      // Check if user is an admin
      const isAdminUser = await isAdmin(req.whitelistAuth.rivetAddress);

      if (!isAdminUser) {
        return res.status(403).json({
          error: "Insufficient permissions - requires epistery::admin list",
        });
      }

      // Get all lists
      const lists = await epistery.getLists();
      res.json({
        lists: lists,
        count: lists.length,
      });
    } catch (error) {
      console.error("[whitelist] Lists error:", error);
      res.status(500).json({
        error: error.message,
      });
    }
  });

  // List endpoint - get specific list (admin only)
  router.get("/list", async (req, res) => {
    try {
      if (!req.whitelistAuth) {
        return res.status(401).json({
          error: "Not authenticated",
        });
      }

      // Check if user is an admin
      const isAdminUser = await isAdmin(req.whitelistAuth.rivetAddress);

      if (!isAdminUser) {
        return res.status(403).json({
          error: "Insufficient permissions - requires epistery::admin list",
        });
      }

      const listName = req.query.list;

      if (listName) {
        // Get specific list
        const list = await epistery.getList(listName);
        // Normalize 'addr' from smart contract to 'address' for API consistency
        const normalizedList = list.map((entry) => ({
          ...entry,
          address: entry.addr,
          addr: undefined,
        }));
        res.json({
          listName: listName,
          members: normalizedList,
          count: normalizedList.length,
        });
      } else {
        // Get all lists
        const lists = await epistery.getLists();
        res.json({
          lists: lists,
        });
      }
    } catch (error) {
      console.error("[whitelist] List error:", error);
      res.status(500).json({
        error: error.message,
      });
    }
  });

  // Add member endpoint (admin only)
  router.post("/add", express.json(), async (req, res) => {
    try {
      if (!req.whitelistAuth) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated",
        });
      }

      // Check if user is an admin
      const isAdminUser = await isAdmin(req.whitelistAuth.rivetAddress);

      if (!isAdminUser) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions - requires epistery::admin list",
        });
      }

      const { listName, address, name, role, meta } = req.body;

      if (!listName) {
        return res.status(400).json({
          success: false,
          error: "List name is required",
        });
      }

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({
          success: false,
          error: "Invalid Ethereum address",
        });
      }

      await epistery.addToList(
        listName,
        address,
        name || "",
        role || 0,
        meta || "",
      );

      res.json({
        success: true,
        listName: listName,
        address: address,
      });
    } catch (error) {
      console.error("[whitelist] Add error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Remove member endpoint (admin only)
  router.post("/remove", express.json(), async (req, res) => {
    try {
      if (!req.whitelistAuth) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated",
        });
      }

      // Check if user is an admin
      const isAdminUser = await isAdmin(req.whitelistAuth.rivetAddress);

      if (!isAdminUser) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions - requires epistery::admin list",
        });
      }

      const { listName, address } = req.body;

      if (!listName) {
        return res.status(400).json({
          success: false,
          error: "List name is required",
        });
      }

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({
          success: false,
          error: "Invalid Ethereum address",
        });
      }

      await epistery.removeFromList(listName, address);

      res.json({
        success: true,
        listName: listName,
        address: address,
      });
    } catch (error) {
      console.error("[whitelist] Remove error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Status endpoint
  router.get("/status", async (req, res) => {
    try {
      res.json({
        agent: "whitelist",
        version: "1.0.0",
        delegationSupported: true,
        namedListsSupported: true,
        merkleTreeEnabled: false,
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  });

  // Request access endpoint - allows users to request whitelist access
  router.post("/request-access", express.json(), async (req, res) => {
    try {
      const { address, listName, agentName, message } = req.body;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({
          success: false,
          error: "Invalid Ethereum address",
        });
      }

      if (!listName) {
        return res.status(400).json({
          success: false,
          error: "List name is required",
        });
      }

      // Check if already requested
      const existing = pendingRequests.find(
        (r) =>
          r.address.toLowerCase() === address.toLowerCase() &&
          r.listName === listName,
      );

      if (existing) {
        return res.json({
          success: true,
          alreadyRequested: true,
          message: "Access request already pending",
        });
      }

      const request = {
        address,
        listName,
        agentName: agentName || "unknown",
        message: message || "",
        timestamp: new Date().toISOString(),
        status: "pending",
      };

      pendingRequests.push(request);

      res.json({
        success: true,
        message: "Access request submitted",
      });
    } catch (error) {
      console.error("[whitelist] Request access error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get pending access requests (admin only)
  router.get("/pending-requests", async (req, res) => {
    try {
      if (!req.whitelistAuth) {
        return res.status(401).json({
          error: "Not authenticated",
        });
      }

      // Check if user is an admin
      const isAdminUser = await isAdmin(req.whitelistAuth.rivetAddress);

      if (!isAdminUser) {
        return res.status(403).json({
          error: "Insufficient permissions - requires epistery::admin list",
        });
      }

      res.json({
        requests: pendingRequests.filter((r) => r.status === "pending"),
        count: pendingRequests.filter((r) => r.status === "pending").length,
      });
    } catch (error) {
      console.error("[whitelist] Get pending requests error:", error);
      res.status(500).json({
        error: error.message,
      });
    }
  });

  // Approve/deny access request (admin only)
  router.post("/handle-request", express.json(), async (req, res) => {
    try {
      if (!req.whitelistAuth) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated",
        });
      }

      // Check if user is an admin
      const isAdminUser = await isAdmin(req.whitelistAuth.rivetAddress);

      if (!isAdminUser) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions - requires epistery::admin list",
        });
      }

      const { address, listName, approved, role } = req.body;

      if (!address || !listName || approved === undefined) {
        return res.status(400).json({
          success: false,
          error: "address, listName, and approved fields are required",
        });
      }

      // Find the request
      const request = pendingRequests.find(
        (r) =>
          r.address.toLowerCase() === address.toLowerCase() &&
          r.listName === listName,
      );

      if (!request) {
        return res.status(404).json({
          success: false,
          error: "Request not found",
        });
      }

      if (approved) {
        // Add to whitelist
        await epistery.addToList(
          listName,
          address,
          "",
          role !== undefined ? role : 2, // default to role 2 (write)
          JSON.stringify({
            addedBy: req.whitelistAuth.rivetAddress,
            addedMethod: "access-request",
            requestedAt: request.timestamp,
            approvedAt: new Date().toISOString(),
          }),
        );

        request.status = "approved";
      } else {
        request.status = "denied";
      }

      pendingRequests.pop();
      res.json({
        success: true,
        approved,
        address,
        listName,
      });
    } catch (error) {
      console.error("[whitelist] Handle request error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}
