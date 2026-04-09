import { Chain, ChainConfig } from './Chain';

type ChainCtor = (new (config: ChainConfig) => Chain) & { defaults: Partial<ChainConfig> };

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
 * Get a Chain instance for the given provider config. The caller's config
 * is merged ON TOP of the subclass's built-in defaults, so only chainId is
 * strictly required — everything else (name, rpc, currency) comes from the
 * chain class if not explicitly overridden.
 *
 * This means a host installation only needs to set `privateRpc` in
 * `~/.epistery/config.ini` for chains where the public RPC is insufficient;
 * all other details live in the chain class.
 *
 * If no subclass is registered for the chainId, returns a generic Chain —
 * which uses pure EIP-1559 with no floors and the standard estimateGas.
 */
export function chainFor(config: ChainConfig): Chain {
  if (config.chainId == null) {
    throw new Error(`chainFor: provider config missing chainId: ${JSON.stringify(config)}`);
  }
  const Ctor = REGISTRY.get(Number(config.chainId)) || Chain;
  // Subclass defaults fill in anything the caller didn't specify.
  const merged: ChainConfig = { ...(Ctor.defaults as ChainConfig), ...config };
  // If caller provided only `rpc` but chain has a default public RPC,
  // preserve the public one for UI display.
  if (!config.publicRpc && Ctor.defaults.rpc) {
    merged.publicRpc = Ctor.defaults.rpc;
  }
  return new Ctor(merged);
}

/**
 * Return the built-in chain list — one entry per registered chain, using
 * each subclass's defaults. This is the authoritative network list for
 * UI dropdowns. No root config needed.
 */
export function registeredChains(): ChainConfig[] {
  const chains: ChainConfig[] = [];
  for (const [chainId, Ctor] of REGISTRY) {
    chains.push({
      ...(Ctor.defaults as ChainConfig),
      chainId,
    });
  }
  return chains;
}

/** Visible for tests / debug. Returns true if a chainId has a registered subclass. */
export function hasRegisteredChain(chainId: number): boolean {
  return REGISTRY.has(Number(chainId));
}

/** Visible for tests / debug. Returns the list of registered chainIds. */
export function registeredChainIds(): number[] {
  return Array.from(REGISTRY.keys());
}
