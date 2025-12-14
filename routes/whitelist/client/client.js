/**
 * Epistery Whitelist Agent - Client Script
 *
 * This script is loaded by publisher sites to enforce access control.
 * It checks for authentication status and verifies whitelist status.
 *
 * Usage:
 *   <script src="/.well-known/epistery/whitelist/client.js"></script>
 */

(function () {
  "use strict";

  const ACCESS_DENIED_HTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Access Denied</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 3rem;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 500px;
          text-align: center;
        }
        h1 {
          color: #2d3748;
          margin: 0 0 1rem 0;
          font-size: 2rem;
        }
        p {
          color: #4a5568;
          line-height: 1.6;
          margin: 0 0 2rem 0;
        }
        .icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        .address {
          background: #f7fafc;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-family: monospace;
          font-size: 0.875rem;
          margin: 1rem 0;
          word-break: break-all;
        }
        .button {
          display: inline-block;
          background: #667eea;
          color: white;
          padding: 0.75rem 2rem;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.2s;
        }
        .button:hover {
          background: #5a67d8;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">[X]</div>
        <h1>Access Denied</h1>
        <p>Your wallet address is not authorized to access this site.</p>
        <div class="address" id="currentAddress">Loading...</div>
        <p>If you believe this is an error, please contact the site administrator.</p>
        <a href="/.well-known/epistery/status" class="button">View Epistery Status</a>
      </div>
      <script>
        const urlParams = new URLSearchParams(window.location.search);
        const address = urlParams.get('address');
        if (address) {
          document.getElementById('currentAddress').textContent = address;
        }
      </script>
    </body>
    </html>
  `;

  /**
   * Get epistery base path
   */
  function getEpisteryBasePath() {
    // Extract base path from current script
    const scripts = document.getElementsByTagName("script");
    for (let script of scripts) {
      if (script.src && script.src.includes("/whitelist/client.js")) {
        const url = new URL(script.src);
        return url.pathname.replace("/whitelist/client.js", "");
      }
    }
    return "/.well-known/epistery";
  }

  const EPISTERY_PATH = getEpisteryBasePath();

  /**
   * Check whitelist access
   */
  async function checkAccess(listName) {
    try {
      const url = new URL(
        `${EPISTERY_PATH}/whitelist/check`,
        window.location.origin
      );
      if (listName) {
        url.searchParams.set("list", listName);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("[whitelist] Access check failed:", error);
      return {
        allowed: false,
        error: error.message,
      };
    }
  }

  /**
   * Show access denied page
   */
  function showAccessDenied(address) {
    document.open();
    document.write(ACCESS_DENIED_HTML);
    document.close();

    if (address) {
      const url = new URL(window.location.href);
      url.searchParams.set("address", address);
      window.history.replaceState({}, "", url);
    }
  }

  /**
   * Check if site requires access control
   * Reads from meta tag: <meta name="epistery-access" content="required|optional">
   */
  function isAccessControlRequired() {
    const meta = document.querySelector('meta[name="epistery-access"]');
    const mode = meta ? meta.getAttribute("content") : "optional";
    return mode === "required";
  }

  /**
   * Get list name from meta tag or default
   * <meta name="epistery-list" content="channel::premium">
   */
  function getListName() {
    const meta = document.querySelector('meta[name="epistery-list"]');
    return meta ? meta.getAttribute("content") : null;
  }

  /**
   * Lazy check - only verify if authenticated
   */
  async function lazyCheck() {
    const listName = getListName();
    const result = await checkAccess(listName);

    window.episteryAccess = {
      allowed: result.allowed,
      address: result.address,
      domain: result.domain,
      listName: result.listName,
      mode: result.allowed ? "authenticated" : "passive",
      devMode: result.devMode || false,
    };

    if (result.allowed) {
      console.log("[whitelist] Access granted for:", result.address);
      window.dispatchEvent(
        new CustomEvent("epistery:access-granted", {
          detail: window.episteryAccess,
        })
      );
    } else {
      console.log(
        "[whitelist] Access denied:",
        result.error || "Not authenticated"
      );
      window.dispatchEvent(
        new CustomEvent("epistery:access-denied", {
          detail: window.episteryAccess,
        })
      );
    }

    return result.allowed;
  }

  /**
   * Main initialization
   */
  async function init() {
    console.log("[whitelist] Initializing access control...");

    const required = isAccessControlRequired();
    const listName = getListName();

    if (!required) {
      // Optional mode - don't block page load
      await lazyCheck();
      return;
    }

    // Required mode - enforce access control
    console.log("[whitelist] Access control REQUIRED for this page");

    const result = await checkAccess(listName);

    if (!result.allowed) {
      console.log(
        "[whitelist] Access denied:",
        result.error || "Not whitelisted"
      );
      showAccessDenied(result.address);
      return;
    }

    console.log("[whitelist] Access granted for:", result.address);

    window.episteryAccess = {
      allowed: true,
      address: result.address,
      domain: result.domain,
      listName: result.listName,
      mode: "required",
      devMode: result.devMode || false,
    };

    window.dispatchEvent(
      new CustomEvent("epistery:access-granted", {
        detail: window.episteryAccess,
      })
    );
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Export public API
  window.episteryWhitelist = {
    // Passive check - doesn't block
    check: lazyCheck,

    // Check specific list
    checkList: checkAccess,

    // Get current status without making requests
    getStatus: () => window.episteryAccess,

    // Get base path
    getBasePath: () => EPISTERY_PATH,

    version: "1.0.0",
  };
})();
