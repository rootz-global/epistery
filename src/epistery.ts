import {
  ClientWalletInfo,
  DomainConfig,
  EpisteryStatus,
  Utils,
  WalletConfig,
  KeyExchangeRequest,
  KeyExchangeResponse,
  SubmitSignedTransactionRequest,
  SubmitSignedTransactionResponse
} from './utils/index.js';
import { ethers } from 'ethers';
import { loadClientModule } from './utils/clientModule';

export class Epistery {
  private static ipfsApiUrl: string | undefined;
  private static ipfsGatewayUrl: string | undefined;
  private static isInitialized: boolean = false;

  // Gas estimation constants
  private static readonly FALLBACK_GAS_LIMIT = 200000;

  constructor() { }

  public static async initialize(): Promise<void> {
    if (Epistery.isInitialized)
      return;

    Epistery.isInitialized = true;
  }

  public static async getStatus(client: ClientWalletInfo, server: DomainConfig): Promise<EpisteryStatus> {
    // Build nativeCurrency object from flat fields with sensible defaults
    let nativeCurrency = undefined;
    if (server?.provider?.nativeCurrencySymbol) {
      nativeCurrency = {
        symbol: server.provider.nativeCurrencySymbol,
        name: server.provider.nativeCurrencyName || server.provider.nativeCurrencySymbol,
        decimals: Number(server.provider.nativeCurrencyDecimals) || 18
      };
    }

    // Read IPFS config from root config
    const config = Utils.GetConfig();
    const rootConfig = await config.read('/');
    const ipfsConfig = rootConfig.ipfs;

    const status: EpisteryStatus = {
      server: {
        walletAddress: server?.wallet?.address,
        publicKey: server?.wallet?.publicKey,
        provider: server?.provider?.name,
        chainId: server?.provider?.chainId,
        rpc: server?.provider?.rpc,
        nativeCurrency: nativeCurrency
      },
      client: {
        walletAddress: client?.address,
        publicKey: client?.publicKey
      },
      ipfs: ipfsConfig,
      timestamp: new Date().toISOString()
    }

    return status;
  }

  public static async handleKeyExchange(request: KeyExchangeRequest, serverWallet: WalletConfig): Promise<KeyExchangeResponse | null> {
    try {
      // Proof of signer: the message names signerAddress, and the recovered
      // address from `signature` must equal it. Contract claims (if any) are
      // verified separately by the caller via on-chain isAuthorized — not
      // here.
      const { keyExchangeMessage } = await loadClientModule('key-exchange-message.mjs');
      const expectedMessage = keyExchangeMessage({ address: request.signerAddress, challenge: request.challenge });

      if (request.message !== expectedMessage) {
        console.error('Key exchange message mismatch');
        console.error('Expected:', expectedMessage);
        console.error('Received:', request.message);
        return null;
      }

      const recoveredAddress = ethers.utils.verifyMessage(request.message, request.signature);

      if (recoveredAddress.toLowerCase() !== request.signerAddress.toLowerCase()) {
        console.error('Signer verification failed');
        return null;
      }

      // Generate server challenge and create response message
      const serverChallenge = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const responseMessage = `Epistery Server Response - ${serverWallet.address} - ${serverChallenge}`;

      // Sign the response with server's private key
      const serverEthersWallet = ethers.Wallet.fromMnemonic(serverWallet.mnemonic);
      const serverSignature = await serverEthersWallet.signMessage(responseMessage);

      // Define available services (can be extended)
      const services = [
        'data-write',
        'data-read',
        'identity-verification',
        'blockchain-interaction'
      ];

      const response: KeyExchangeResponse = {
        serverAddress: serverWallet.address,
        serverPublicKey: serverWallet.publicKey,
        services: services,
        challenge: serverChallenge,
        signature: serverSignature,
        identified: true,
        authenticated: false,
        profile: undefined
      };

      return response;

    } catch (error) {
      console.error('Key exchange error:', error);
      return null;
    }
  }

  /**
   * Submits a client-signed transaction to the blockchain
   *
   * This is the final step in client-side signing flow.
   * The transaction is already signed and immutable.
   * Server just broadcasts it to the blockchain.
   *
   * @param signedTx - Complete signed transaction (hex string)
   * @returns Transaction receipt
   */
  public static async submitSignedTransaction(
    signedTx: string
  ): Promise<any> {
    // RPC from ~/.epistery root config via Config — not process.env. A signed
    // tx already encodes its chainId; we just need the network's RPC, which
    // single-domain apps declare once at root [provider].
    const rootData = await Utils.GetConfig().read('/');
    const rpcUrl = rootData.provider?.rpc ?? rootData.default?.provider?.rpc;
    if (!rpcUrl) {
      throw new Error('No provider RPC configured in ~/.epistery (root [provider])');
    }
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Parse signed transaction to validate and log
    const parsedTx = ethers.utils.parseTransaction(signedTx);
    console.log(`Broadcasting signed transaction:`);
    console.log(`  From: ${parsedTx.from}`);
    console.log(`  To: ${parsedTx.to}`);
    console.log(`  Nonce: ${parsedTx.nonce}`);
    console.log(`  Gas Limit: ${parsedTx.gasLimit?.toString()}`);

    // Broadcast to blockchain
    const response = await provider.sendTransaction(signedTx);
    console.log(`  Transaction Hash: ${response.hash}`);
    console.log(`  Waiting for confirmation...`);

    // Wait for confirmation
    const receipt = await response.wait();
    console.log(`  Confirmed in block: ${receipt.blockNumber}`);
    console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`  Status: ${receipt.status === 1 ? 'Success' : 'Reverted'}`);

    return {
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
      contractAddress: receipt.contractAddress,
      receipt: receipt
    };
  }
}
