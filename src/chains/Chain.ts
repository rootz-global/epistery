import { ethers } from 'ethers';
import { ProviderConfig } from '../utils/types';

/**
 * Per-chain fee data, returned in the shape ethers v5 expects on a transaction.
 * EIP-1559 chains return maxFeePerGas/maxPriorityFeePerGas.
 * Legacy chains return gasPrice.
 */
export interface ChainFeeData {
  maxFeePerGas?: ethers.BigNumber;
  maxPriorityFeePerGas?: ethers.BigNumber;
  gasPrice?: ethers.BigNumber;
}

/**
 * Optional per-chain knobs that root config can override without editing code.
 * Each subclass reads only what it cares about.
 */
export interface ChainPolicy {
  // EIP-1559 floors (in gwei)
  minPriorityFeeGwei?: number;
  maxFeeMultiplier?: number;        // applied to max(networkMax, minPriority * 2)
  // Legacy gas
  minGasPriceGwei?: number;
  // Gas limit estimation safety
  gasLimitMultiplier?: number;      // applied to estimateGas result
}

/**
 * Extended provider config that may carry per-chain policy + a private RPC URL.
 * The plain `ProviderConfig` from utils/types stays the wire/storage shape;
 * `ChainConfig` is what the Chain object actually holds in memory.
 */
export interface ChainConfig extends ProviderConfig {
  publicRpc?: string;
  privateRpc?: string;
  policy?: ChainPolicy;
}

/**
 * Base class for an EVM chain. Subclasses override only the policy hooks
 * that are actually different from the EIP-1559 default.
 *
 * The Chain object owns:
 *   - the JsonRpcProvider (with explicit network info, fixing "could not detect network")
 *   - per-chain fee policy (getFeeData)
 *   - the contract Proxy that injects fee data into write calls
 *   - gas-limit estimation with a per-chain safety multiplier
 *
 * The Chain object does NOT own:
 *   - wallets / private keys
 *   - contract ABIs
 *   - domain config storage
 */
export class Chain {
  readonly chainId: number;
  readonly name: string;
  readonly rpc: string;                       // private/server-side RPC (with API key if any)
  readonly publicRpc: string | undefined;     // public RPC (safe to expose to browsers)
  readonly currency: { name: string; symbol: string; decimals: number };
  readonly policy: ChainPolicy;

  private _provider: ethers.providers.JsonRpcProvider | null = null;

  constructor(config: ChainConfig) {
    if (config.chainId == null) {
      throw new Error(`Chain config missing chainId: ${JSON.stringify(config)}`);
    }
    this.chainId = Number(config.chainId);
    this.name = config.name;
    this.rpc = config.privateRpc || config.rpc;
    this.publicRpc = config.publicRpc || config.rpc;
    this.currency = {
      name: config.nativeCurrencyName || '',
      symbol: config.nativeCurrencySymbol || '',
      decimals: config.nativeCurrencyDecimals || 18,
    };
    this.policy = config.policy || {};
  }

  /**
   * Lazily-built provider with explicit network info.
   * Passing `{ name, chainId }` to the JsonRpcProvider constructor avoids
   * ethers' "could not detect network" error when the RPC is briefly
   * unreachable at startup — ethers will skip its eth_chainId probe.
   */
  get provider(): ethers.providers.JsonRpcProvider {
    if (!this._provider) {
      this._provider = new ethers.providers.JsonRpcProvider(this.rpc, {
        name: this.name,
        chainId: this.chainId,
      });
    }
    return this._provider;
  }

  /** EIP-1559 by default. Subclasses override for legacy gasPrice chains. */
  supportsEIP1559(): boolean {
    return true;
  }

  /**
   * Default fee policy: pass through whatever the network reports via
   * eth_feeHistory / eth_gasPrice. Subclasses override to apply per-chain
   * floors (Polygon's 25 gwei priority floor, JOC's gasPrice floor, etc.).
   */
  async getFeeData(): Promise<ChainFeeData> {
    const fd = await this.provider.getFeeData();
    if (this.supportsEIP1559() && fd.maxFeePerGas && fd.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: fd.maxFeePerGas,
        maxPriorityFeePerGas: fd.maxPriorityFeePerGas,
      };
    }
    if (fd.gasPrice) {
      return { gasPrice: fd.gasPrice };
    }
    throw new Error(`Chain ${this.name} (${this.chainId}) returned no usable fee data`);
  }

  /**
   * Estimate gas limit with this chain's safety multiplier.
   * Used by callers that need to populate gasLimit explicitly (e.g. for
   * pre-funding calculations). Most write calls will let ethers estimate
   * automatically; this is for the cases where ethers' estimate is unsafe
   * (Polygon Amoy, JOC) and a multiplier is required.
   */
  async estimateGas(
    populated: ethers.providers.TransactionRequest
  ): Promise<ethers.BigNumber> {
    const estimate = await this.provider.estimateGas(populated);
    const multiplier = this.policy.gasLimitMultiplier ?? 1.3;
    // Multiply via integer math to stay in BigNumber-land.
    const num = Math.round(multiplier * 100);
    return estimate.mul(num).div(100);
  }

  /**
   * Wrap an ethers.Contract so every state-mutating method automatically
   * receives this chain's fee data as the transaction overrides argument.
   *
   * Uses Object.create (prototype chain) — the wrapper object gets its own
   * writable properties for the write methods while reads of everything else
   * (.address, .signer, view functions, .interface, etc.) fall through to
   * the original contract via the prototype.
   *
   * Why not a Proxy: ethers v5 defines ABI methods with defineReadOnly
   * (non-writable, non-configurable). V8's proxy invariant requires get
   * traps to return the *original* value for such properties — returning a
   * wrapped function throws TypeError. Object.create avoids this because
   * the own properties on the child shadow the prototype's frozen ones.
   *
   * NOTE: epistery-host's DomainChain does NOT use this because all its
   * write call sites already pass feeData explicitly. This method exists
   * for other consumers (e.g. CLI tools, agents) that want automatic fee
   * injection without threading overrides through every call.
   *
   * @param contract - the ethers.Contract instance
   * @param abi - the same ABI used to construct the contract; needed to
   *              identify which methods are state-mutating.
   */
  wrapContract<T extends ethers.Contract>(contract: T, abi: ReadonlyArray<any>): T {
    const writeFns = new Set<string>();
    for (const item of abi) {
      if (item.type !== 'function') continue;
      if (item.stateMutability === 'view' || item.stateMutability === 'pure') continue;
      if (typeof item.name === 'string') writeFns.add(item.name);
    }
    const chain = this;
    const wrapped = Object.create(contract);

    for (const name of writeFns) {
      const original = contract[name as keyof T];
      if (typeof original !== 'function') continue;
      Object.defineProperty(wrapped, name, {
        value: async function (...args: any[]) {
          let overrides: any;
          const last = args[args.length - 1];
          if (Chain.isOverridesObject(last)) {
            const fee = await chain.getFeeData();
            overrides = { ...fee, ...last };
            args[args.length - 1] = overrides;
          } else {
            overrides = await chain.getFeeData();
            args.push(overrides);
          }
          return (original as Function).apply(contract, args);
        },
        writable: true,
        configurable: true,
      });
    }

    return wrapped as T;
  }

  /**
   * Recognize a transaction-overrides object so we don't mistake it for a
   * positional argument. Excludes BigNumbers and arrays explicitly.
   */
  static isOverridesObject(x: any): boolean {
    if (!x || typeof x !== 'object') return false;
    if (Array.isArray(x)) return false;
    if (ethers.BigNumber.isBigNumber(x)) return false;
    return (
      'gasPrice' in x ||
      'maxFeePerGas' in x ||
      'maxPriorityFeePerGas' in x ||
      'gasLimit' in x ||
      'nonce' in x ||
      'value' in x ||
      'from' in x ||
      'type' in x
    );
  }

  /** Convenience: gwei → BigNumber wei */
  protected gwei(n: number): ethers.BigNumber {
    return ethers.utils.parseUnits(String(n), 'gwei');
  }
}