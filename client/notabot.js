/**
 * Notabot Score System
 *
 * Tracks natural human browser behavior to build a cryptographically-verified
 * score that helps distinguish humans from bots.
 *
 * Based on US Patent 11,120,469 "Browser Proof of Work"
 * Modernized for privacy and practical deployment with Epistery
 *
 * @module notabot
 */

export class NotabotTracker {
  constructor(rivet) {
    this.rivet = rivet;
    this.eventChain = [];
    this.currentPoints = 0;
    this.isTracking = false;

    // Behavioral data collectors
    this.mouseEvents = [];
    this.scrollEvents = [];
    this.focusChanges = [];
    this.touchEvents = [];

    // Thresholds for entropy detection
    this.ENTROPY_THRESHOLD = 0.6;  // Minimum entropy to award points
    this.EVENT_BUFFER_SIZE = 50;   // How many raw events to analyze
    this.COMMIT_INTERVAL = 50;     // Commit to chain every N events

    // Time-gating (economic defense against bots)
    this.MAX_POINTS_PER_MINUTE = 2;  // Can't earn faster than 2 points/minute
    this.sessionStartTime = 0;
    this.pendingCommit = null;       // Commit waiting for funding

    // Timers
    this.lastMouseTime = 0;
    this.lastScrollTime = 0;

    // Load existing chain from storage
    this._loadFromStorage();
  }

  /**
   * Start tracking browser behavior
   * User must opt-in to this functionality
   */
  startTracking() {
    if (this.isTracking) return;

    this.isTracking = true;
    this.sessionStartTime = Date.now();

    // Mouse movement tracking
    window.addEventListener('mousemove', this._handleMouseMove.bind(this));

    // Scroll tracking
    window.addEventListener('scroll', this._handleScroll.bind(this), { passive: true });

    // Focus tracking
    window.addEventListener('focus', this._handleFocus.bind(this));
    window.addEventListener('blur', this._handleBlur.bind(this));

    // Touch tracking (mobile)
    if ('ontouchstart' in window) {
      window.addEventListener('touchstart', this._handleTouch.bind(this), { passive: true });
      window.addEventListener('touchmove', this._handleTouch.bind(this), { passive: true });
    }

    // Session duration check (every 60 seconds)
    this.sessionTimer = setInterval(() => {
      this._checkSessionDuration();
    }, 60000);

    console.log('[Notabot] Tracking started');
  }

  /**
   * Stop tracking
   */
  stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;

    // Remove event listeners
    window.removeEventListener('mousemove', this._handleMouseMove);
    window.removeEventListener('scroll', this._handleScroll);
    window.removeEventListener('focus', this._handleFocus);
    window.removeEventListener('blur', this._handleBlur);

    if ('ontouchstart' in window) {
      window.removeEventListener('touchstart', this._handleTouch);
      window.removeEventListener('touchmove', this._handleTouch);
    }

    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
    }

    console.log('[Notabot] Tracking stopped');
  }

  /**
   * Handle mouse movement
   */
  _handleMouseMove(event) {
    const now = Date.now();
    const timeDelta = now - this.lastMouseTime;

    // Ignore if events are too frequent (likely programmatic)
    if (timeDelta < 10) return;

    this.mouseEvents.push({
      x: event.clientX,
      y: event.clientY,
      time: now,
      timeDelta: timeDelta
    });

    this.lastMouseTime = now;

    // Analyze when buffer is full
    if (this.mouseEvents.length >= this.EVENT_BUFFER_SIZE) {
      this._analyzeMouseEntropy();
    }
  }

  /**
   * Analyze mouse movement entropy
   * Humans have curved, variable-speed paths with micro-corrections
   * Bots have linear, constant-velocity, or teleporting movements
   */
  _analyzeMouseEntropy() {
    if (this.mouseEvents.length < 10) return;

    const events = this.mouseEvents.slice(-this.EVENT_BUFFER_SIZE);

    // Calculate path curvature (deviation from straight line)
    const curvature = this._calculatePathCurvature(events);

    // Calculate velocity variance (humans vary speed)
    const velocityVariance = this._calculateVelocityVariance(events);

    // Calculate timing entropy (irregular intervals are human)
    const timingEntropy = this._calculateTimingEntropy(events);

    // Combine signals into overall entropy score (0.0 - 1.0)
    const entropy = (curvature * 0.4) + (velocityVariance * 0.3) + (timingEntropy * 0.3);

    if (entropy >= this.ENTROPY_THRESHOLD) {
      this._addNotabotEvent('mouse_entropy', entropy);
    }

    // Keep only recent events
    this.mouseEvents = this.mouseEvents.slice(-20);
  }

  /**
   * Calculate path curvature
   * Returns 0.0 (straight line) to 1.0 (highly curved)
   */
  _calculatePathCurvature(events) {
    if (events.length < 3) return 0;

    let totalDeviation = 0;
    let totalDistance = 0;

    for (let i = 1; i < events.length - 1; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      const next = events[i + 1];

      // Expected position if moving in straight line from prev to next
      const ratio = (curr.time - prev.time) / (next.time - prev.time);
      const expectedX = prev.x + (next.x - prev.x) * ratio;
      const expectedY = prev.y + (next.y - prev.y) * ratio;

      // Actual deviation from expected position
      const deviation = Math.sqrt(
        Math.pow(curr.x - expectedX, 2) +
        Math.pow(curr.y - expectedY, 2)
      );

      totalDeviation += deviation;
      totalDistance += Math.sqrt(
        Math.pow(next.x - prev.x, 2) +
        Math.pow(next.y - prev.y, 2)
      );
    }

    // Normalize: more deviation relative to distance = more human-like
    const normalized = totalDistance > 0 ? totalDeviation / totalDistance : 0;
    return Math.min(1.0, normalized * 2); // Scale to 0-1
  }

  /**
   * Calculate velocity variance
   * Humans vary speed; bots maintain constant velocity
   */
  _calculateVelocityVariance(events) {
    if (events.length < 2) return 0;

    const velocities = [];

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];

      const distance = Math.sqrt(
        Math.pow(curr.x - prev.x, 2) +
        Math.pow(curr.y - prev.y, 2)
      );

      const time = (curr.time - prev.time) || 1;
      velocities.push(distance / time);
    }

    // Calculate coefficient of variation
    const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const variance = velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocities.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;

    // Higher variance = more human-like
    return Math.min(1.0, cv);
  }

  /**
   * Calculate timing entropy
   * Humans have irregular intervals; bots are too consistent or too fast
   */
  _calculateTimingEntropy(events) {
    if (events.length < 2) return 0;

    const intervals = [];
    for (let i = 1; i < events.length; i++) {
      intervals.push(events[i].timeDelta);
    }

    // Shannon entropy of interval distribution
    const histogram = {};
    const binSize = 50; // 50ms bins

    intervals.forEach(interval => {
      const bin = Math.floor(interval / binSize) * binSize;
      histogram[bin] = (histogram[bin] || 0) + 1;
    });

    let entropy = 0;
    const total = intervals.length;

    Object.values(histogram).forEach(count => {
      const p = count / total;
      entropy -= p * Math.log2(p);
    });

    // Normalize: higher entropy = more human-like
    const maxEntropy = Math.log2(Object.keys(histogram).length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /**
   * Handle scroll events
   */
  _handleScroll(event) {
    const now = Date.now();
    const scrollY = window.scrollY || window.pageYOffset;

    this.scrollEvents.push({
      y: scrollY,
      time: now,
      timeDelta: now - this.lastScrollTime
    });

    this.lastScrollTime = now;

    // Analyze when buffer is full
    if (this.scrollEvents.length >= this.EVENT_BUFFER_SIZE) {
      this._analyzeScrollPattern();
    }
  }

  /**
   * Analyze scroll patterns
   * Humans: variable speed, pauses to read, backtracking
   * Bots: constant velocity or instant jumps
   */
  _analyzeScrollPattern() {
    if (this.scrollEvents.length < 10) return;

    const events = this.scrollEvents.slice(-this.EVENT_BUFFER_SIZE);

    // Calculate scroll velocity variance
    const velocities = [];
    let hasBacktrack = false;

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];

      const distance = curr.y - prev.y;
      const time = (curr.time - prev.time) || 1;
      velocities.push(Math.abs(distance) / time);

      // Detect backtracking (scrolling up after scrolling down)
      if (distance < 0 && i > 1 && events[i - 1].y > events[i - 2].y) {
        hasBacktrack = true;
      }
    }

    const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
    const variance = velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocities.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;

    // Entropy from variance + bonus for backtracking (very human)
    const entropy = Math.min(1.0, cv * 0.8 + (hasBacktrack ? 0.2 : 0));

    if (entropy >= this.ENTROPY_THRESHOLD) {
      this._addNotabotEvent('scroll_pattern', entropy);
    }

    this.scrollEvents = this.scrollEvents.slice(-20);
  }

  /**
   * Handle focus/blur events
   */
  _handleFocus(event) {
    this.focusChanges.push({ type: 'focus', time: Date.now() });
  }

  _handleBlur(event) {
    this.focusChanges.push({ type: 'blur', time: Date.now() });
    this._analyzeFocusPattern();
  }

  /**
   * Analyze focus patterns
   * Natural tab switching indicates human multitasking
   */
  _analyzeFocusPattern() {
    if (this.focusChanges.length < 4) return;

    // Look for natural focus/blur cycles
    const recentChanges = this.focusChanges.slice(-10);
    let cycles = 0;

    for (let i = 1; i < recentChanges.length; i++) {
      if (recentChanges[i].type === 'focus' && recentChanges[i - 1].type === 'blur') {
        cycles++;
      }
    }

    // Multiple focus cycles = human behavior
    if (cycles >= 2) {
      const entropy = Math.min(1.0, cycles / 5);
      this._addNotabotEvent('focus_pattern', entropy);
    }

    this.focusChanges = this.focusChanges.slice(-10);
  }

  /**
   * Handle touch events (mobile)
   */
  _handleTouch(event) {
    const now = Date.now();

    if (event.touches.length > 0) {
      const touch = event.touches[0];
      this.touchEvents.push({
        x: touch.clientX,
        y: touch.clientY,
        pressure: touch.force || 0,
        time: now
      });

      // Multi-finger gestures are very human
      if (event.touches.length > 1) {
        this._addNotabotEvent('multitouch_gesture', 0.9);
      }
    }

    // Analyze when buffer is full
    if (this.touchEvents.length >= this.EVENT_BUFFER_SIZE) {
      this._analyzeTouchPattern();
      this.touchEvents = this.touchEvents.slice(-20);
    }
  }

  /**
   * Analyze touch patterns
   * Natural gestures have variable pressure and curved paths
   */
  _analyzeTouchPattern() {
    if (this.touchEvents.length < 10) return;

    const events = this.touchEvents.slice(-this.EVENT_BUFFER_SIZE);

    // Pressure variance (if supported)
    const pressures = events.map(e => e.pressure).filter(p => p > 0);
    if (pressures.length > 5) {
      const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
      const variance = pressures.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pressures.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

      const entropy = Math.min(1.0, cv * 1.5);
      if (entropy >= this.ENTROPY_THRESHOLD) {
        this._addNotabotEvent('touch_pressure', entropy);
      }
    }

    // Path curvature (same as mouse)
    const curvature = this._calculatePathCurvature(events);
    if (curvature >= this.ENTROPY_THRESHOLD) {
      this._addNotabotEvent('touch_path', curvature);
    }
  }

  /**
   * Check session duration
   * Longer engaged sessions are more human
   */
  _checkSessionDuration() {
    const duration = Date.now() - this.sessionStartTime;
    const minutes = duration / 60000;

    // Award points for sustained engagement
    if (minutes >= 1) {
      const entropy = Math.min(1.0, minutes / 10); // Up to 10 minutes
      this._addNotabotEvent('session_duration', entropy);
    }
  }

  /**
   * Add a notabot event to the chain
   */
  async _addNotabotEvent(type, entropy) {
    // TIME-GATING: Prevent earning points faster than real time allows
    const elapsedMinutes = (Date.now() - this.sessionStartTime) / 60000;
    const maxPointsForTime = Math.floor(elapsedMinutes * this.MAX_POINTS_PER_MINUTE);

    if (this.currentPoints >= maxPointsForTime) {
      console.log(`[Notabot] Rate limited: ${this.currentPoints} points in ${elapsedMinutes.toFixed(1)} minutes (max ${maxPointsForTime})`);
      return; // Can't earn faster than real time
    }

    const previousHash = this.eventChain.length > 0
      ? this.eventChain[this.eventChain.length - 1].hash
      : '0x0000000000000000000000000000000000000000000000000000000000000000';

    const event = {
      timestamp: Date.now(),
      entropyScore: entropy,
      eventType: type,
      previousHash: previousHash
    };

    // Calculate hash
    event.hash = await this._hashEvent(event);

    // Sign with rivet private key
    try {
      event.signature = await this.rivet.sign(event.hash);
    } catch (error) {
      console.error('[Notabot] Failed to sign event:', error);
      return;
    }

    this.eventChain.push(event);

    // Award points
    const points = Math.floor(entropy * 10);
    this.currentPoints += points;

    console.log(`[Notabot] +${points} points from ${type} (entropy: ${entropy.toFixed(3)}, total: ${this.currentPoints})`);

    // Save to storage
    this._saveToStorage();

    // Commit to chain if threshold reached
    if (this.eventChain.length % this.COMMIT_INTERVAL === 0) {
      await this.commitToChain();
    }
  }

  /**
   * Hash an event
   */
  async _hashEvent(event) {
    const data = `${event.previousHash}${event.timestamp}${event.eventType}${event.entropyScore}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return '0x' + hashHex;
  }

  /**
   * Commit current chain to identity contract
   */
  async commitToChain() {
    if (this.eventChain.length === 0) {
      console.log('[Notabot] No events to commit');
      return;
    }

    const commitment = {
      totalPoints: this.currentPoints,
      chainHead: this.eventChain[this.eventChain.length - 1].hash,
      eventCount: this.eventChain.length,
      lastUpdate: Date.now()
    };

    try {
      // Get identity contract address (will be set by witness.js)
      const identityContractAddress = this.rivet.identityContract;

      // Send to server for blockchain commitment
      const response = await fetch('/.well-known/epistery/notabot/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitment: commitment,
          eventChain: this.eventChain,
          identityContractAddress: identityContractAddress,
          requestFunding: true  // Ask server to fund if needed
        })
      });

      if (response.status === 402) {
        // Payment Required - need to wait for funding
        const data = await response.json();
        console.log('[Notabot] Commit requires funding. Next funding available in:', data.nextFundingIn);
        console.log('[Notabot] Current points:', data.currentPoints, '(not yet on-chain)');

        // Store pending commitment
        this.pendingCommit = {
          commitment: commitment,
          eventChain: [...this.eventChain], // Clone
          timestamp: Date.now()
        };
        this._saveToStorage();
        return;
      }

      if (response.status === 403) {
        // Forbidden - suspicious behavior detected
        const data = await response.json();
        console.error('[Notabot] Commit denied:', data.error);
        console.error('[Notabot]', data.message);
        return;
      }

      if (!response.ok) {
        throw new Error(`Commit failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('[Notabot] Committed to chain:', result.transactionHash);
      console.log('[Notabot] Points now on-chain:', this.currentPoints);

      // Clear pending commit
      this.pendingCommit = null;
      this._saveToStorage();

    } catch (error) {
      console.error('[Notabot] Failed to commit:', error);

      // Store as pending if it was a network error
      if (error.message.includes('fetch')) {
        this.pendingCommit = {
          commitment: commitment,
          eventChain: [...this.eventChain],
          timestamp: Date.now()
        };
        this._saveToStorage();
      }
    }
  }

  /**
   * Retry pending commit (call after funding becomes available)
   */
  async retryPendingCommit() {
    if (!this.pendingCommit) {
      console.log('[Notabot] No pending commit to retry');
      return;
    }

    console.log('[Notabot] Retrying pending commit...');

    const temp = this.pendingCommit;
    this.pendingCommit = null; // Clear to avoid recursion

    // Temporarily swap in pending data
    const currentChain = this.eventChain;
    const currentPoints = this.currentPoints;

    this.eventChain = temp.eventChain;
    this.currentPoints = temp.commitment.totalPoints;

    await this.commitToChain();

    // Restore current data if commit failed
    if (this.pendingCommit) {
      this.eventChain = currentChain;
      this.currentPoints = currentPoints;
    }
  }

  /**
   * Get current score
   */
  getScore() {
    return {
      points: this.currentPoints,
      eventCount: this.eventChain.length,
      lastUpdate: this.eventChain.length > 0
        ? this.eventChain[this.eventChain.length - 1].timestamp
        : null
    };
  }

  /**
   * Get event chain (for verification)
   */
  getEventChain() {
    return this.eventChain;
  }

  /**
   * Save chain to localStorage
   */
  _saveToStorage() {
    try {
      localStorage.setItem('epistery_notabot_chain', JSON.stringify({
        eventChain: this.eventChain,
        currentPoints: this.currentPoints,
        sessionStartTime: this.sessionStartTime,
        pendingCommit: this.pendingCommit
      }));
    } catch (error) {
      console.error('[Notabot] Failed to save to storage:', error);
    }
  }

  /**
   * Load chain from localStorage
   */
  _loadFromStorage() {
    try {
      const stored = localStorage.getItem('epistery_notabot_chain');
      if (stored) {
        const data = JSON.parse(stored);
        this.eventChain = data.eventChain || [];
        this.currentPoints = data.currentPoints || 0;
        this.sessionStartTime = data.sessionStartTime || Date.now();
        this.pendingCommit = data.pendingCommit || null;

        if (this.pendingCommit) {
          console.log(`[Notabot] Loaded ${this.eventChain.length} events, ${this.currentPoints} points (pending commit)`);
        } else {
          console.log(`[Notabot] Loaded ${this.eventChain.length} events, ${this.currentPoints} points`);
        }
      }
    } catch (error) {
      console.error('[Notabot] Failed to load from storage:', error);
    }
  }
}

export default NotabotTracker;
