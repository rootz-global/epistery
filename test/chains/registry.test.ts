import { describe, it, expect } from 'vitest';
import { Chain } from '../../src/chains/Chain';
import { chainFor, registerChain, providerConfigFor } from '../../src/chains/registry';
import { PolygonChain } from '../../src/chains/PolygonChain';

/**
 * A downstream app registering its own chain class is a supported extension point:
 * the registry Map is module-scoped and last-write-wins, "so a downstream app can
 * override a built-in". These tests cover what such a subclass can and cannot set.
 */
describe('chainFor + subclass defaults', () => {
  const PRIVATE = 'http://10.0.0.1:8545';
  const PUBLIC = 'http://10.0.0.1:8645';

  it('lets a subclass set publicRpc via its own defaults', () => {
    class WrappedPolygon extends PolygonChain {
      static chainId = 137;
      static defaults = { ...PolygonChain.defaults, privateRpc: PRIVATE, publicRpc: PUBLIC };
    }
    registerChain(137, WrappedPolygon as unknown as typeof Chain);
    try {
      const chain = chainFor({ chainId: 137 });
      // Before this fix, publicRpc came back as PolygonChain.defaults.rpc — a THIRD-PARTY
      // endpoint — because the guard tested the caller's config rather than the merged one.
      expect(chain.publicRpc).toBe(PUBLIC);
      expect(chain.rpc).toBe(PRIVATE);
    } finally {
      registerChain(137, PolygonChain as unknown as typeof Chain);
    }
  });

  it('still falls back to the chain default when NOBODY specifies a public RPC', () => {
    const chain = chainFor({ chainId: 137 });
    expect(chain.publicRpc).toBe(PolygonChain.defaults.rpc);
  });

  it('still lets an explicit caller value win over the subclass default', () => {
    class WrappedPolygon extends PolygonChain {
      static chainId = 137;
      static defaults = { ...PolygonChain.defaults, publicRpc: PUBLIC };
    }
    registerChain(137, WrappedPolygon as unknown as typeof Chain);
    try {
      expect(chainFor({ chainId: 137, publicRpc: 'http://explicit:1234' }).publicRpc).toBe('http://explicit:1234');
    } finally {
      registerChain(137, PolygonChain as unknown as typeof Chain);
    }
  });

  it('providerConfigFor still flattens the two tiers when persisting (documented, not fixed here)', () => {
    const chain = chainFor({ chainId: 137, privateRpc: PRIVATE, publicRpc: PUBLIC });
    const persisted: any = providerConfigFor(chain);
    // Recorded so the behaviour is visible rather than surprising. A caller that saves
    // a chain and reloads it loses the public/private distinction entirely.
    expect(persisted.publicRpc).toBeUndefined();
    expect(persisted.rpc).toBe(PRIVATE);
  });
});
