import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/**
 * Status routes - root, status page, client libraries, contract artifacts
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function statusRoutes(epistery) {
  const router = express.Router();

  // Root endpoint - returns JSON for API clients, HTML for browsers
  router.get("/", (req, res) => {
    // Check if client wants JSON (API request)
    const acceptsJson = req.accepts("json") && !req.accepts("html");

    if (acceptsJson) {
      return res.json(epistery.buildStatus());
    }

    // Return HTML for browsers
    const domain = req.hostname;
    const serverWallet = epistery.domain;

    // Determine the root path from the request's base URL
    // baseUrl will be '/' or '/.well-known/epistery' depending on mount point
    const rootPath = req.baseUrl || "/";

    const templatePath = path.resolve(rootDir, "client/status.html");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).send("Status template not found");
    }

    let template = fs.readFileSync(templatePath, "utf8");

    // Template replacement
    template = template.replace(/\{\{server\.domain\}\}/g, domain);
    template = template.replace(
      /\{\{server\.walletAddress\}\}/g,
      serverWallet?.wallet?.address || "",
    );
    template = template.replace(
      /\{\{server\.provider\}\}/g,
      serverWallet?.provider?.name || "",
    );
    template = template.replace(
      /\{\{server\.chainId\}\}/g,
      serverWallet?.provider?.chainId?.toString() || "",
    );
    template = template.replace(
      /\{\{timestamp\}\}/g,
      new Date().toISOString(),
    );
    template = template.replace(/\{\{epistery\.rootPath\}\}/g, rootPath);

    res.send(template);
  });

  // Client library files
  const library = {
    "client.js": path.resolve(rootDir, "client/client.js"),
    "witness.js": path.resolve(rootDir, "client/witness.js"),
    "wallet.js": path.resolve(rootDir, "client/wallet.js"),
    "notabot.js": path.resolve(rootDir, "client/notabot.js"),
    "export.js": path.resolve(rootDir, "client/export.js"),
    "ethers.js": path.resolve(rootDir, "client/ethers.js"),
    "ethers.min.js": path.resolve(rootDir, "client/ethers.min.js"),
  };

  // Serve client library files
  router.get("/lib/:module", (req, res) => {
    const modulePath = library[req.params.module];
    if (!modulePath) return res.status(404).send("Library not found");

    if (!fs.existsSync(modulePath))
      return res.status(404).send("File not found");

    const ext = modulePath.slice(modulePath.lastIndexOf(".") + 1);
    const contentTypes = {
      js: "text/javascript",
      mjs: "text/javascript",
      css: "text/css",
      html: "text/html",
      json: "application/json",
    };

    if (contentTypes[ext]) {
      res.set("Content-Type", contentTypes[ext]);
    }

    res.sendFile(modulePath);
  });

  // Serve contract artifacts
  router.get("/artifacts/:contractFile", (req, res) => {
    const contractFile = req.params.contractFile;
    const artifactPath = path.resolve(
      rootDir,
      "artifacts/contracts",
      contractFile.replace(".json", ".sol"),
      contractFile,
    );

    if (!fs.existsSync(artifactPath)) {
      return res.status(404).send("Contract artifact not found");
    }

    res.set("Content-Type", "application/json");
    res.sendFile(artifactPath);
  });

  router.get("/status", (req, res) => {
    const domain = req.hostname;
    const serverWallet = epistery.domain;

    // Determine the root path from the request's base URL
    const rootPath = req.baseUrl;

    const templatePath = path.resolve(rootDir, "client/status.html");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).send("Status template not found");
    }

    let template = fs.readFileSync(templatePath, "utf8");

    // Template replacement
    template = template.replace(/\{\{server\.domain\}\}/g, domain);
    template = template.replace(
      /\{\{server\.walletAddress\}\}/g,
      serverWallet?.wallet?.address || "",
    );
    template = template.replace(
      /\{\{server\.provider\}\}/g,
      serverWallet?.provider?.name || "",
    );
    template = template.replace(
      /\{\{server\.chainId\}\}/g,
      serverWallet?.provider?.chainId?.toString() || "",
    );
    template = template.replace(
      /\{\{timestamp\}\}/g,
      new Date().toISOString(),
    );
    template = template.replace(/\{\{epistery\.rootPath\}\}/g, rootPath);

    res.send(template);
  });

  return router;
}
