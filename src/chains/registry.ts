import { Chain, ChainConfig } from './Chain';

type ChainCtor = new (config: ChainConfig) => Chain;

/**
 * Registry of chainId → Chain subclass.
 *
 * Adding a chain is a single-file operation: write `MyChain.ts` extending
 * `Chain`, and at the bottom of that file call:
 *
 *     registerChain(MyChain.chainId, MyChain);
 *
 * Then ensure the file is imported once during startup (the built-in
 * `chains/index.ts` does this for the chains shipped with the package; for
 * downstream additions, just `import 'mypackage/chains/MyChain'` from your
 * app entry point).
 *
 * No edits to this file or the barrel are required.
 */
const REGISTRY = new Map<number, ChainCtor>();

/**
 * Register a Chain subclass for a given chainId. Overwrites any existing
 * entry — last write wins, so a downstream app can override a built-in if it
 * wants different fee policy.
 */
export function registerChain(chainId: number, ctor: ChainCtor): void {
  REGISTRY.set(Number(chainId), ctor);
}

/**
 * Get a Chain instance for the given provider config. If no subclass is
 * registered for the chainId, returns a generic Chain — which uses pure
 * EIP-1559 with no floors and the standard estimateGas. That works for any
 * well-behaved EVM chain; misbehaving chains need their own subclass.
 */
export function chainFor(config: ChainConfig): Chain {
  if (config.chainId == null) {
    throw new Error(`chainFor: provider config missing chainId: ${JSON.stringify(config)}`);
  }
  const Ctor = REGISTRY.get(Number(config.chainId)) || Chain;
  return new Ctor(config);
}

/** Visible for tests / debug. Returns true if a chainId has a registered subclass. */
export function hasRegisteredChain(chainId: number): boolean {
  return REGISTRY.has(Number(chainId));
}

/** Visible for tests / debug. Returns the list of registered chainIds. */
export function registeredChainIds(): number[] {
  return Array.from(REGISTRY.keys());
}
