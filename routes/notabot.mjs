import express from "express";
import { Epistery } from "../dist/epistery.js";

/**
 * Notabot funding tracker
 *
 * Funding economics: Server funds legitimate rivets once per hour to enable
 * notabot score commits. Bot farms must either pay their own gas (expensive
 * at scale) or wait real time (defeating purpose).
 */
const notabotFunding = {
  // rivetAddress => { lastFunded: timestamp, fundingCount: number, firstFunded: timestamp }
  ledger: new Map(),

  // Configuration
  FUNDING_COOLDOWN: 60 * 60 * 1000, // 1 hour
  MAX_FUNDINGS_PER_DAY: 30, // Catch runaway scripts
  FUNDING_AMOUNT: "20000000000000000", // 0.02 native token (enough for ~2-3 commits on Polygon)

  getLastFundingTime(rivetAddress) {
    const entry = this.ledger.get(rivetAddress);
    return entry ? entry.lastFunded : 0;
  },

  recordFunding(rivetAddress) {
    const now = Date.now();
    const entry = this.ledger.get(rivetAddress);

    if (!entry) {
      this.ledger.set(rivetAddress, {
        lastFunded: now,
        fundingCount: 1,
        firstFunded: now,
      });
    } else {
      entry.lastFunded = now;
      entry.fundingCount++;
    }
  },

  async fundForSingleCommit(rivetAddress, serverWallet) {
    try {
      // Check if server wallet has sufficient balance
      const balance = await serverWallet.wallet.provider.getBalance(
        serverWallet.wallet.address,
      );
      const fundingAmount = this.FUNDING_AMOUNT;

      if (balance.lt(fundingAmount)) {
        console.error(
          "[Notabot] Server wallet insufficient balance for funding",
        );
        return { success: false, reason: "insufficient_server_balance" };
      }

      // Send funding transaction
      const tx = await serverWallet.wallet.sendTransaction({
        to: rivetAddress,
        value: fundingAmount,
        maxFeePerGas: 50000000000, // 50 gwei
        maxPriorityFeePerGas: 30000000000, // 30 gwei
      });

      await tx.wait();

      console.log(
        `[Notabot] Funded ${rivetAddress} with ${fundingAmount} wei`,
      );
      this.recordFunding(rivetAddress);

      return {
        success: true,
        txHash: tx.hash,
        amount: fundingAmount,
        nextEligible: Date.now() + this.FUNDING_COOLDOWN,
      };
    } catch (error) {
      console.error("[Notabot] Funding transaction failed:", error);
      return { success: false, reason: "tx_failed", error: error.message };
    }
  },

  detectSuspiciousPattern(rivetAddress, eventChain) {
    const entry = this.ledger.get(rivetAddress);

    if (!entry) return { suspicious: false };

    // Check for excessive funding requests
    const daysSinceFirst =
      (Date.now() - entry.firstFunded) / (1000 * 60 * 60 * 24);
    const fundingsPerDay =
      daysSinceFirst > 0
        ? entry.fundingCount / daysSinceFirst
        : entry.fundingCount;

    if (fundingsPerDay > this.MAX_FUNDINGS_PER_DAY) {
      return {
        suspicious: true,
        reason: "excessive_funding_rate",
        details: `${fundingsPerDay.toFixed(1)} fundings/day (max: ${this.MAX_FUNDINGS_PER_DAY})`,
      };
    }

    // Check for synthetic event patterns (all events at exactly same interval)
    if (eventChain && eventChain.length > 5) {
      const intervals = [];
      for (let i = 1; i < eventChain.length; i++) {
        intervals.push(
          eventChain[i].timestamp - eventChain[i - 1].timestamp,
        );
      }

      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance =
        intervals.reduce((sum, interval) => {
          return sum + Math.pow(interval - avgInterval, 2);
        }, 0) / intervals.length;

      const stdDev = Math.sqrt(variance);

      // If standard deviation is very low, timing is too uniform (bot-like)
      if (stdDev < avgInterval * 0.1) {
        return {
          suspicious: true,
          reason: "uniform_timing",
          details: `Events too evenly spaced (stdDev: ${stdDev.toFixed(0)}ms, avg: ${avgInterval.toFixed(0)}ms)`,
        };
      }
    }

    return { suspicious: false };
  },
};

/**
 * Notabot routes - commit and retrieve notabot scores
 * @param {Object} epistery - The EpisteryAttach instance
 * @returns {express.Router}
 */
export default function notabotRoutes(epistery) {
  const router = express.Router();

  // Notabot score endpoint - commit score to identity contract
  router.post("/commit", async (req, res) => {
    try {
      const {
        commitment,
        eventChain,
        identityContractAddress,
        requestFunding,
      } = req.body;

      if (!commitment || !eventChain || !identityContractAddress) {
        return res.status(400).json({
          error:
            "Missing required fields: commitment, eventChain, identityContractAddress",
        });
      }

      // Get rivet information from session/auth
      // For now, expect rivet info in request body
      const { rivetAddress, rivetMnemonic } = req.body;

      if (!rivetAddress || !rivetMnemonic) {
        return res.status(400).json({
          error: "Missing rivet authentication: rivetAddress, rivetMnemonic",
        });
      }

      // Check for suspicious patterns BEFORE funding
      const suspiciousCheck = notabotFunding.detectSuspiciousPattern(
        rivetAddress,
        eventChain,
      );
      if (suspiciousCheck.suspicious) {
        console.log(
          `[Notabot] Suspicious pattern detected for ${rivetAddress}: ${suspiciousCheck.reason}`,
        );
        return res.status(403).json({
          error: "Suspicious activity detected",
          reason: suspiciousCheck.reason,
          details: suspiciousCheck.details,
          message:
            "This rivet has been flagged for unusual behavior patterns",
        });
      }

      // Handle funding request
      if (requestFunding) {
        const lastFunded = notabotFunding.getLastFundingTime(rivetAddress);
        const timeSinceLastFunding = Date.now() - lastFunded;

        // Check if funding cooldown has elapsed
        if (timeSinceLastFunding < notabotFunding.FUNDING_COOLDOWN) {
          const waitMinutes = Math.ceil(
            (notabotFunding.FUNDING_COOLDOWN - timeSinceLastFunding) / 60000,
          );
          return res.status(402).json({
            error: "Funding not available yet",
            reason: "cooldown_active",
            lastFunded: lastFunded,
            nextEligible: lastFunded + notabotFunding.FUNDING_COOLDOWN,
            waitMinutes: waitMinutes,
            message: `Funding available once per hour. Please wait ${waitMinutes} more minutes.`,
          });
        }

        // Fund the rivet
        const serverWallet = epistery.domain;
        const fundingResult = await notabotFunding.fundForSingleCommit(
          rivetAddress,
          serverWallet,
        );

        if (!fundingResult.success) {
          return res.status(503).json({
            error: "Funding failed",
            reason: fundingResult.reason,
            details: fundingResult.error,
            message:
              "Server unable to provide funding. You may need to fund your own transaction.",
          });
        }

        console.log(
          `[Notabot] Funded ${rivetAddress}, next eligible: ${new Date(fundingResult.nextEligible).toISOString()}`,
        );
      }

      // Commit the score to the identity contract
      const result = await Epistery.commitNotabotScore(
        rivetAddress,
        rivetMnemonic,
        { commitment, eventChain },
        identityContractAddress,
      );

      res.json(result);
    } catch (error) {
      console.error("Commit notabot score error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get notabot score for a rivet
  router.get("/score/:rivetAddress", async (req, res) => {
    try {
      const { rivetAddress } = req.params;
      const { identityContractAddress } = req.query;

      if (!rivetAddress) {
        return res.status(400).json({ error: "Missing rivet address" });
      }

      const score = await Epistery.getNotabotScore(
        rivetAddress,
        identityContractAddress,
      );
      res.json(score);
    } catch (error) {
      console.error("Get notabot score error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
