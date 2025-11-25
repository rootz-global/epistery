/**
 * Epistery Delegation Module
 *
 * Handles creation and verification of delegation tokens for cross-subdomain authentication.
 * Allows rivet wallets to delegate signing authority to sister domains.
 */

/**
 * Create a delegation token for a target domain
 *
 * @param {Object} options - Delegation options
 * @param {string} options.domain - Target domain (e.g., 'mydomain.com')
 * @param {string[]} options.scope - Permission scopes (e.g., ['whitelist:read'])
 * @param {number} options.durationDays - Token validity in days (default: 30)
 * @param {Object} wallet - Wallet object with rivetAddress and signing capability
 * @returns {Promise<Object>} Delegation token with signature
 */
export async function createDelegationToken(options, wallet) {
  const {
    domain,
    scope = ['whitelist:read'],
    durationDays = 30
  } = options;

  if (!domain) {
    throw new Error('Domain is required for delegation');
  }

  if (!wallet || !wallet.address) {
    throw new Error('Wallet is required for delegation');
  }

  // Use rivet address if available (for identity contracts)
  const rivetAddress = wallet.rivetAddress || wallet.address;

  // Create delegation object
  const delegation = {
    issuer: window.location.hostname, // epistery.mydomain.com
    subject: rivetAddress,
    audience: domain,
    scope: scope,
    expires: Date.now() + (durationDays * 24 * 60 * 60 * 1000),
    nonce: crypto.randomUUID(),
    createdAt: Date.now(),
    version: '1.0'
  };

  // Sign the delegation with rivet private key
  const delegationString = JSON.stringify(delegation);
  const messageBuffer = new TextEncoder().encode(delegationString);

  let signature;

  if (wallet.source === 'rivet' && wallet.keyPair) {
    // Sign with non-extractable rivet key
    const signatureBuffer = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: 'SHA-256'
      },
      wallet.keyPair.privateKey,
      messageBuffer
    );

    signature = arrayBufferToHex(signatureBuffer);
  } else if (wallet.signer) {
    // Sign with ethers signer (web3/browser wallet)
    const messageHash = ethers.utils.hashMessage(delegationString);
    signature = await wallet.signer.signMessage(delegationString);
  } else {
    throw new Error('Wallet does not support signing');
  }

  // Store delegation in localStorage for this domain
  const delegations = getDelegatedDomains();
  if (!delegations.includes(domain)) {
    delegations.push(domain);
    saveDelegatedDomains(delegations);
  }

  return {
    delegation,
    signature,
    publicKey: wallet.publicKey
  };
}

/**
 * Verify a delegation token
 *
 * @param {Object} token - Token to verify
 * @param {string} expectedDomain - Expected audience domain
 * @returns {Promise<Object>} Verification result
 */
export async function verifyDelegationToken(token, expectedDomain) {
  try {
    const { delegation, signature, publicKey } = token;

    // 1. Check structure
    if (!delegation || !signature) {
      return { valid: false, error: 'Invalid token structure' };
    }

    // 2. Check expiration
    if (Date.now() > delegation.expires) {
      return { valid: false, error: 'Token expired' };
    }

    // 3. Check audience
    if (expectedDomain && delegation.audience !== expectedDomain) {
      return { valid: false, error: 'Audience mismatch' };
    }

    // 4. Verify signature
    const delegationString = JSON.stringify(delegation);
    const messageBuffer = new TextEncoder().encode(delegationString);

    try {
      // Import public key for verification
      const publicKeyBuffer = hexToArrayBuffer(publicKey);
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        publicKeyBuffer,
        {
          name: 'ECDSA',
          namedCurve: 'P-256'
        },
        false,
        ['verify']
      );

      const signatureBuffer = hexToArrayBuffer(signature);
      const isValid = await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: 'SHA-256'
        },
        cryptoKey,
        signatureBuffer,
        messageBuffer
      );

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }
    } catch (error) {
      // Fallback: try Ethereum signature recovery
      try {
        const recoveredAddress = ethers.utils.verifyMessage(delegationString, signature);
        if (recoveredAddress.toLowerCase() !== delegation.subject.toLowerCase()) {
          return { valid: false, error: 'Signature verification failed' };
        }
      } catch (e) {
        return { valid: false, error: `Signature verification failed: ${error.message}` };
      }
    }

    return {
      valid: true,
      rivetAddress: delegation.subject,
      domain: delegation.audience,
      scope: delegation.scope,
      expires: delegation.expires
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Get list of delegated domains from localStorage
 */
export function getDelegatedDomains() {
  try {
    const stored = localStorage.getItem('epistery_delegated_domains');
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Save list of delegated domains to localStorage
 */
function saveDelegatedDomains(domains) {
  try {
    localStorage.setItem('epistery_delegated_domains', JSON.stringify(domains));
  } catch (e) {
    console.error('Failed to save delegated domains:', e);
  }
}

/**
 * Revoke delegation for a domain
 */
export function revokeDelegation(domain) {
  const delegations = getDelegatedDomains();
  const filtered = delegations.filter(d => d !== domain);
  saveDelegatedDomains(filtered);

  // TODO: Update Merkle tree on-chain
}

/**
 * Helper: Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Helper: Convert hex string to ArrayBuffer
 */
function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

export default {
  createDelegationToken,
  verifyDelegationToken,
  getDelegatedDomains,
  revokeDelegation
};
