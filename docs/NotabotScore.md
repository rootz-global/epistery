# Notabot Score System

## Overview

The Notabot Score is an Epistery feature that provides websites with a cryptographically-verified indicator of whether a browser session is likely operated by a human or a bot. Based on US Patent 11,120,469 "Browser Proof of Work" but modernized for privacy and practical deployment.

**Key Innovation**: Instead of raw CPU proof-of-work (which wastes energy and can be gamed), the system analyzes natural human browser behavior patterns to build up a tamper-evident score stored on the user's rivet (browser-locked identity).

## Core Principles

1. **Privacy-Preserving**: No actual interaction data (mouse coordinates, keystrokes) is stored - only entropy scores and event counts
2. **Tamper-Evident**: Score built as a hash chain, making retroactive modification computationally infeasible
3. **Rivet-Locked**: Score bound to browser identity (rivet), creating portable reputation across Epistery-enabled sites
4. **Policy-Agnostic**: System provides information; websites decide policy (require humans, allow bots, etc.)
5. **Opt-In**: Users control whether to participate in notabot scoring

## Problem Statement

From the original patent:

> "Embodiments are directed to methods and systems for determining the identity of a user as a person or a robot. In some embodiments, the methods and systems engage a web browser to produce a token and calculate a computation cost associated with the token production."

**Modern Challenge**: Traditional CAPTCHA annoys users, proof-of-work wastes energy, and IP-based bot detection fails with VPNs/proxies. Websites need a frictionless way to assess human likelihood without invading privacy.

**Epistery Solution**: Build a behavioral legitimacy score into the user's cryptographic identity that travels with them across the web.

## How It Works

### 1. Behavioral Signal Collection (Client-Side)

The `witness.js` client library monitors browser interactions for natural human patterns:

#### Signals Measured:

- **Mouse Movement Entropy**: Randomness and naturalness of cursor paths
  - Humans: Curved, variable-speed movements with micro-corrections
  - Bots: Linear paths, constant velocity, or teleportation

- **Interaction Timing**: Variability in action intervals
  - Humans: Variable delays (200-800ms typical), influenced by content
  - Bots: Uniform timing or suspiciously fast reactions

- **Session Duration**: Time actively engaged with page
  - Longer sessions with periodic activity suggest human attention

- **Scroll Patterns**: How user navigates content
  - Humans: Variable scroll speeds, pauses to read, backtracking
  - Bots: Constant scroll velocity or instant jumps

- **Focus Events**: Tab switching, window focus patterns
  - Humans: Natural multitasking patterns

- **Touch/Gesture Patterns** (Mobile): Pressure, swipe curves, multi-finger gestures
  - Extremely difficult for bots to simulate convincingly

### 2. Notabot Event Generation

When sufficient behavioral entropy is detected, witness.js generates a **notabot event**:

```javascript
{
  timestamp: 1704924531000,
  entropyScore: 0.847,          // 0.0-1.0, higher = more human-like
  eventType: 'mouse_entropy',   // or 'scroll_pattern', 'session_duration', etc.
  previousHash: '0xabc123...',
  signature: '0xdef456...'      // Signed by rivet private key
}
```

The event is hashed and chained to the previous event:

```javascript
currentHash = keccak256(
  previousHash +
  timestamp +
  eventType +
  entropyScore
)
```

### 3. Notabot Points Accumulation

Points are awarded based on entropy quality:

```javascript
pointsAwarded = Math.floor(entropyScore * 10)  // 0-10 points per event
```

**Decay Mechanism**: Points have a half-life to ensure freshness:
- Points older than 30 days contribute 50% of their value
- Points older than 90 days contribute 0%

This prevents "zombie" rivets from maintaining high scores without active use.

### 4. Chain Commitment to Identity Contract

Periodically (e.g., every 50 points or when leaving site), the notabot chain is committed to the rivet's identity contract on-chain:

```solidity
struct NotabotCommitment {
  uint256 totalPoints;
  bytes32 chainHead;        // Hash of most recent event
  uint256 eventCount;
  uint256 lastUpdate;
  bytes signature;          // Rivet signature proving ownership
}
```

### 5. Verification and Retrieval

When a website queries notabot score:

1. Retrieve commitment from identity contract
2. Witness.js provides full event chain
3. Server verifies:
   - Chain hashes are valid
   - Events are signed by rivet private key
   - Commitment matches chain head
   - Points calculated correctly from entropy scores

## Technical Architecture

### Client-Side (witness.js)

```javascript
class NotabotTracker {
  constructor() {
    this.eventChain = [];
    this.currentPoints = 0;
    this.listeners = [];
  }

  // Monitor browser interactions
  startTracking() {
    window.addEventListener('mousemove', this.trackMouseEntropy);
    window.addEventListener('scroll', this.trackScrollPattern);
    window.addEventListener('focus', this.trackFocusPattern);
    // ... other listeners
  }

  // Calculate entropy from mouse movement
  trackMouseEntropy(events) {
    const entropy = this.calculatePathEntropy(events);
    if (entropy > THRESHOLD) {
      this.addNotabotEvent('mouse_entropy', entropy);
    }
  }

  // Add event to chain
  addNotabotEvent(type, entropy) {
    const previousHash = this.eventChain.length > 0
      ? this.eventChain[this.eventChain.length - 1].hash
      : '0x0000...';

    const event = {
      timestamp: Date.now(),
      entropyScore: entropy,
      eventType: type,
      previousHash: previousHash
    };

    event.hash = this.hashEvent(event);
    event.signature = await this.rivet.sign(event.hash);

    this.eventChain.push(event);
    this.currentPoints += Math.floor(entropy * 10);

    // Commit to chain if threshold reached
    if (this.eventChain.length % 50 === 0) {
      await this.commitToChain();
    }
  }

  // Commit to identity contract
  async commitToChain() {
    const commitment = {
      totalPoints: this.currentPoints,
      chainHead: this.eventChain[this.eventChain.length - 1].hash,
      eventCount: this.eventChain.length,
      lastUpdate: Date.now()
    };

    // Submit to identity contract via Epistery
    await Epistery.updateNotabotScore(commitment);
  }

  // Get current score
  getScore() {
    return {
      points: this.currentPoints,
      eventCount: this.eventChain.length,
      lastUpdate: this.eventChain[this.eventChain.length - 1]?.timestamp
    };
  }
}
```

### Server-Side (Express Middleware)

Epistery middleware automatically enriches request with notabot data:

```javascript
// In Epistery.attach(app)
app.use(async (req, res, next) => {
  // ... existing Epistery middleware

  if (req.app.epistery.clientWallet) {
    // Retrieve notabot score from identity contract
    const notabotData = await Epistery.getNotabotScore(
      req.app.epistery.clientWallet.address
    );

    req.app.epistery.clientWallet.notabotPoints = notabotData.points;
    req.app.epistery.clientWallet.notabotLastUpdate = notabotData.lastUpdate;
    req.app.epistery.clientWallet.notabotVerified = notabotData.verified;
  }

  next();
});
```

### Developer Usage

Websites can use notabot score in their route handlers:

```javascript
app.post('/checkout', async (req, res) => {
  const wallet = req.app.epistery.clientWallet;

  if (!wallet) {
    return res.status(401).json({ error: 'No rivet wallet' });
  }

  // Policy: Require human-like behavior for purchases
  if (wallet.notabotPoints < 100) {
    return res.status(403).json({
      error: 'Insufficient human verification',
      currentPoints: wallet.notabotPoints,
      requiredPoints: 100,
      suggestion: 'Browse site naturally for a few minutes to build score'
    });
  }

  // Process checkout...
});
```

```javascript
app.get('/api/data', async (req, res) => {
  const wallet = req.app.epistery.clientWallet;

  // Policy: Different rate limits for humans vs potential bots
  const rateLimit = wallet?.notabotPoints > 50 ? 1000 : 10;

  // ... apply rate limit and serve data
});
```

```javascript
app.get('/premium-content', async (req, res) => {
  const wallet = req.app.epistery.clientWallet;

  // Multi-tier access
  if (wallet?.notabotPoints > 200) {
    // Verified human - full access
    return res.json({ content: fullContent, tier: 'premium' });
  } else if (wallet?.notabotPoints > 50) {
    // Probably human - limited access
    return res.json({ content: limitedContent, tier: 'basic' });
  } else {
    // Unknown/bot - public access only
    return res.json({ content: publicContent, tier: 'public' });
  }
});
```

## Smart Contract Extension

Add to IdentityContract.sol:

```solidity
contract IdentityContract {
  // ... existing code

  struct NotabotCommitment {
    uint256 totalPoints;
    bytes32 chainHead;
    uint256 eventCount;
    uint256 lastUpdate;
  }

  // Rivet address => notabot commitment
  mapping(address => NotabotCommitment) public notabotScores;

  // Update notabot score (called by rivet owner)
  function updateNotabotScore(
    uint256 points,
    bytes32 chainHead,
    uint256 eventCount
  ) external onlyAuthorizedRivet {
    notabotScores[msg.sender] = NotabotCommitment({
      totalPoints: points,
      chainHead: chainHead,
      eventCount: eventCount,
      lastUpdate: block.timestamp
    });

    emit NotabotScoreUpdated(msg.sender, points, eventCount);
  }

  // Get notabot score for a rivet
  function getNotabotScore(address rivetAddress)
    external
    view
    returns (NotabotCommitment memory)
  {
    return notabotScores[rivetAddress];
  }

  event NotabotScoreUpdated(
    address indexed rivet,
    uint256 points,
    uint256 eventCount
  );
}
```

## Privacy Guarantees

### What is Stored

**On-Chain (Public)**:
- Total points
- Event count
- Last update timestamp
- Chain head hash

**Client-Side Only**:
- Full event chain with timestamps and entropy scores
- Behavioral pattern data

### What is NOT Stored

- Mouse coordinates or paths
- Keystroke timing or content
- Specific page URLs visited
- Session duration details
- Any personally identifiable information

### Cross-Site Privacy

Sites can query: "Does this rivet have a high notabot score?"

Sites CANNOT query: "Where did this rivet earn its points?"

The score is a **portable reputation** without revealing browsing history.

## Attack Resistance

### Sybil Attack (Creating Fake Identities)

**Attack**: Generate many rivets with fake behavioral data.

**Defense**:
- Each rivet creation requires gas fees
- Building convincing entropy patterns takes time
- Sites can require minimum rivet age + notabot score

### Replay Attack (Reusing Event Chains)

**Attack**: Copy someone else's event chain.

**Defense**:
- Events signed by rivet private key
- Signature verification fails if replayed to different rivet

### Synthetic Behavior (Bot Simulating Human Patterns)

**Attack**: Program bot to generate "human-like" mouse movements.

**Defense**:
- Multi-signal approach (hard to fake all signals convincingly)
- Entropy thresholds tuned to detect synthetic patterns
- Continuous evolution of detection algorithms
- Sites can require higher scores if fraud detected

### Time Manipulation

**Attack**: Backdate events to inflate score.

**Defense**:
- On-chain commitment includes `block.timestamp`
- Events with timestamps far from commitment time are rejected
- Score decay based on last update time

## Economic Defense Model

The most sophisticated attack is a **bot farm**: thousands of automated browsers running in parallel to build up fake notabot scores. Traditional entropy analysis alone cannot stop a well-programmed bot simulator. The solution is **economic game theory**: make bot farming so expensive or slow that it's not worthwhile.

### Time-Gating: The Core Defense

**Problem**: A bot could simulate months of human browsing in minutes by running at 100x speed.

**Solution**: Rate-limit point accumulation to **real wall-clock time**.

```javascript
MAX_POINTS_PER_MINUTE = 2  // Maximum 2 points per minute

elapsedMinutes = (Date.now() - sessionStartTime) / 60000
maxPointsForTime = Math.floor(elapsedMinutes * MAX_POINTS_PER_MINUTE)

if (currentPoints >= maxPointsForTime) {
  // Rate limited - can't earn faster than 2 points/minute
  return;
}
```

**Result**:
- Earning 100 points (checkout threshold) takes ~50 minutes minimum
- Earning 200 points (premium tier) takes ~100 minutes minimum
- **You cannot parallelize time** - 1000 bot browsers still take 50 minutes each

This is the **critical** defense: time cannot be faked or accelerated in a datacenter.

### Server-Funded Gas: The Economic Lever

**Problem**: Most rivet wallets have zero gas balance. If users must pay gas fees for every commit, they won't participate.

**Solution**: **Server funds legitimate users once per hour**.

#### How Funding Works

1. **User browses naturally** → Earns 50 points over 25 minutes
2. **Client attempts commit** → Sends `requestFunding: true`
3. **Server checks rate limit** → Last funded > 1 hour ago?
4. **Server checks patterns** → Does behavior look human?
5. **Server sends 0.02 native tokens** → Enough for ~2-3 commits
6. **User commits score** → Using server-provided gas

#### Funding Responses

**200 OK** - Funded and committed successfully
```json
{
  "success": true,
  "txHash": "0xabc...",
  "totalPoints": 50,
  "nextEligible": 1704928131000
}
```

**402 Payment Required** - Too soon, must wait
```json
{
  "error": "Funding not available yet",
  "reason": "cooldown_active",
  "waitMinutes": 37,
  "message": "Funding available once per hour. Please wait 37 more minutes."
}
```

**403 Forbidden** - Suspicious activity detected
```json
{
  "error": "Suspicious activity detected",
  "reason": "uniform_timing",
  "details": "Events too evenly spaced (stdDev: 42ms, avg: 5000ms)",
  "message": "This rivet has been flagged for unusual behavior patterns"
}
```

**503 Service Unavailable** - Server wallet low on funds
```json
{
  "error": "Funding failed",
  "reason": "insufficient_server_balance",
  "message": "Server unable to provide funding. You may need to fund your own transaction."
}
```

### The Economics

#### For Legitimate Users
- **Server cost**: ~$0.02 per hour per active user (on Polygon)
- **User experience**: Zero friction - just browse naturally
- **Participation rate**: High (users don't need crypto knowledge)

#### For Bot Farmers

**Option 1: Wait Real Time**
- 1000 bot browsers × 50 minutes = **50,000 bot-minutes to reach checkout threshold**
- Defeats purpose of automation - might as well hire real humans

**Option 2: Pay Own Gas**
- 1000 rivets × $0.02/hour × 4 hours to build reputation = **$80**
- Plus ongoing commit costs
- At scale: 100,000 rivets = **$8,000** for basic scores
- **Detection risk**: Paying from same funding wallet = easy to block entire batch

**Option 3: Request Server Funding Frequently**
- Limited to once per hour per rivet
- Suspicious pattern detection triggers 403 blocks
- 1000 rivets × 50 points each = 1000 hours of server monitoring
- **High detection probability** before reaching useful scores

### Suspicious Pattern Detection

The server analyzes behavior **before** providing funding:

#### Excessive Funding Rate
```javascript
MAX_FUNDINGS_PER_DAY = 30  // ~2 per hour max average

fundingsPerDay = fundingCount / daysSinceFirstFunding

if (fundingsPerDay > 30) {
  return 403; // Likely bot or runaway script
}
```

#### Uniform Timing (Bot Signature)
```javascript
// Calculate standard deviation of event intervals
intervals = [event[i].timestamp - event[i-1].timestamp for all events]
stdDev = standardDeviation(intervals)
avgInterval = mean(intervals)

if (stdDev < avgInterval * 0.1) {
  // Events are too evenly spaced - humans vary more
  return 403;
}
```

**Example**:
- Human: [2.3s, 0.8s, 5.1s, 1.2s, 3.7s] → High variance ✓
- Bot: [2.0s, 2.0s, 2.0s, 2.0s, 2.0s] → Suspiciously uniform ✗

### Configuration

Server-side settings in `index.mjs`:

```javascript
const notabotFunding = {
  FUNDING_COOLDOWN: 60 * 60 * 1000,     // 1 hour
  MAX_FUNDINGS_PER_DAY: 30,              // Catch runaway scripts
  FUNDING_AMOUNT: '20000000000000000',   // 0.02 native token

  // Polygon Mainnet: ~$0.02 per funding
  // JOC: Even cheaper
  // Ethereum: More expensive, may need adjustment
}
```

Client-side settings in `client/notabot.js`:

```javascript
class NotabotTracker {
  constructor(rivet) {
    this.MAX_POINTS_PER_MINUTE = 2;    // Time-gating rate
    this.COMMIT_THRESHOLD = 50;         // Auto-commit every 50 points
  }
}
```

### Why This Works

1. **Time is unfakeable** - You can't parallelize 50 minutes into 5 seconds
2. **Server controls funding** - Bots must either wait or pay
3. **Detection before investment** - Server analyzes patterns before spending gas
4. **Economics favor defense**:
   - Legitimate user cost: $0.02/hour when active
   - Bot farm cost at scale: $80-$8000 for basic coverage
   - Legitimate users browse 1-2 sites/hour
   - Bots need presence across many sites = multiplied costs

5. **Legitimate users subsidized** - Sites that benefit from bot protection pay the trivial funding costs

### Attack Cost Analysis

| Attack Vector | Cost for 1000 Rivets | Time Required | Detection Risk |
|--------------|---------------------|---------------|----------------|
| Wait for funding | $0 | 50,000 bot-minutes | High (pattern analysis) |
| Pay own gas | $80-$8000 | 50 minutes | Medium (wallet correlation) |
| Steal credentials | N/A | N/A | Impossible (rivet = browser-locked) |
| Simulate perfect behavior | $0-$80 | 50 minutes | Very High (entropy analysis) |

**Conclusion**: There is no economically viable path to large-scale bot farming. Small-scale attacks (<10 rivets) are possible but not useful for real-world exploits (spam, scraping, fraud all require scale).

## Scoring Guidelines

### Point Ranges

- **0-50 points**: Unknown/new rivet or potential bot
- **50-100 points**: Some human-like behavior detected
- **100-200 points**: Likely human user
- **200+ points**: High-confidence human with sustained engagement

### Suggested Policies

**E-commerce**:
- Checkout: Require 100+ points
- Add to cart: Require 50+ points
- Browse: No restriction

**Content Sites**:
- Premium content: 150+ points
- Comments: 75+ points
- Read articles: No restriction

**API Services**:
- Rate limits scale with score:
  - 0-50 points: 10 requests/hour
  - 50-100 points: 100 requests/hour
  - 100-200 points: 1000 requests/hour
  - 200+ points: 10000 requests/hour

**Social Platforms**:
- Post content: 100+ points
- Direct messages: 150+ points
- Create account: No restriction (but score visible to others)

## Implementation Roadmap

### Phase 1: Core Infrastructure
- [ ] Extend IdentityContract with notabot storage
- [ ] Deploy updated contracts to test networks
- [ ] Add notabot tracking to witness.js
- [ ] Implement basic entropy calculations

### Phase 2: Server Integration
- [ ] Add notabot retrieval to Epistery middleware
- [ ] Expose score via `req.app.epistery.clientWallet.notabotPoints`
- [ ] Create verification utilities
- [ ] Add decay mechanism

### Phase 3: Testing & Tuning
- [ ] Test entropy thresholds with real users
- [ ] Detect and prevent common bot patterns
- [ ] Tune scoring algorithm
- [ ] Performance optimization

### Phase 4: Documentation & Examples
- [ ] Developer documentation
- [ ] Example policies for common use cases
- [ ] Integration guides
- [ ] Best practices

### Phase 5: Production Deployment
- [ ] Deploy to mainnet (Polygon, JOC, etc.)
- [ ] Monitor for attacks
- [ ] Iterate on detection algorithms
- [ ] Community feedback

## API Reference

### Client-Side (witness.js)

```javascript
// Start tracking (opt-in)
witness.notabot.startTracking()

// Stop tracking
witness.notabot.stopTracking()

// Get current score
const score = witness.notabot.getScore()
// Returns: { points: 150, eventCount: 47, lastUpdate: 1704924531000 }

// Get full event chain (for verification)
const chain = witness.notabot.getEventChain()

// Commit to blockchain
await witness.notabot.commit()
```

### Server-Side (Express)

```javascript
// Access in route handlers
req.app.epistery.clientWallet.notabotPoints        // number
req.app.epistery.clientWallet.notabotLastUpdate    // timestamp
req.app.epistery.clientWallet.notabotVerified      // boolean
req.app.epistery.clientWallet.notabotEventCount    // number

// Verify event chain (if needed)
const isValid = await Epistery.verifyNotabotChain(
  wallet.address,
  eventChain
)
```

### Direct API

```javascript
// Get score for any rivet address
const score = await Epistery.getNotabotScore('0xabc123...')

// Update score (called by rivet owner)
await Epistery.updateNotabotScore({
  totalPoints: 150,
  chainHead: '0xdef456...',
  eventCount: 47
})
```

## References

- **US Patent 11,120,469**: "Browser Proof of Work" (September 14, 2021)
  - Inventors: Michael Sprague, George Mario Fortuna, Sameet U. Durg, Joseph A. Fortuna Jr.
  - Assignee: Popdust, Inc. (GeistM)
  - [Google Patents Link](https://patents.google.com/patent/US11120469B2/en)

- **Related Concepts**:
  - Proof of Work (Bitcoin, blockchain consensus)
  - CAPTCHA (Completely Automated Public Turing test)
  - Behavioral Biometrics
  - Trust Fabric (Epistery architecture)

## License

This specification is part of the Epistery project (MIT License).

The notabot concept builds on US Patent 11,120,469 owned by Popdust, Inc. (GeistM).
