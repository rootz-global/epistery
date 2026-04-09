import { Chain } from './Chain';
import { registerChain } from './registry';

/**
 * Ethereum mainnet (chainId 1).
 *
 * Standard EIP-1559 behavior — ethers' getFeeData is accurate here.
 * No floors, no special multipliers. The base class default works as-is;
 * this subclass exists for the registry and for future overrides.
 */
export class EthereumChain extends Chain {
  static chainId = 1;
}

/**
 * Sepolia testnet (chainId 11155111). Same behavior as Ethereum mainnet.
 */
export class SepoliaChain extends Chain {
  static chainId = 11155111;
}

registerChain(EthereumChain.chainId, EthereumChain);
registerChain(SepoliaChain.chainId, SepoliaChain);