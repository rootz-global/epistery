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
