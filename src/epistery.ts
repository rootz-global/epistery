import {
  ClientWalletInfo,
  DomainConfig,
  EpisteryStatus,
  Utils,
  WalletConfig,
  KeyExchangeRequest,
  KeyExchangeResponse,
  UnsignedTransaction,
  PrepareTransactionRequest,
  PrepareTransactionResponse,
  SubmitSignedTransactionRequest,
  SubmitSignedTransactionResponse
} from './utils/index.js';
import { ethers } from 'ethers';

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

  public static createWallet(): ClientWalletInfo {
    const wallet = ethers.Wallet.createRandom();
    const clientWalletInfo: ClientWalletInfo = {
      address: wallet.address,
      mnemonic: wallet.mnemonic?.phrase || '',
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
    };

    return clientWalletInfo;
  }

  public static getStatus(client: ClientWalletInfo, server: DomainConfig): EpisteryStatus {
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
    const rootConfig = config.read('/');
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
      const expectedMessage = `Epistery Key Exchange - ${request.signerAddress} - ${request.challenge}`;

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
   * Prepares an unsigned "add rivet to IdentityContract" transaction
   *
   * @param signerAddress - Address of the rivet calling addRivet (must be authorized)
   * @param contractAddress - Address of the IdentityContract
   * @param rivetAddressToAdd - Address of the rivet to add
   * @param rivetName - Name for the new rivet
   * @param domain - Domain context
   * @returns Unsigned transaction ready for client to sign
   */
  public static async prepareAddRivetToContract(
    signerAddress: string,
    contractAddress: string,
    rivetAddressToAdd: string,
    rivetName: string,
    domain: string
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get server wallet for funding
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Load IdentityContract artifact - try multiple paths
    const fs = await import('fs/promises');
    const path = await import('path');

    // Try epistery package path first (when running from epistery-host)
    let artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json');

    let artifactData: string;
    try {
      artifactData = await fs.readFile(artifactPath, 'utf-8');
    } catch (e) {
      // Fallback to process.cwd() for development
      artifactPath = path.join(process.cwd(), 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json');
      artifactData = await fs.readFile(artifactPath, 'utf-8');
    }

    const artifact = JSON.parse(artifactData);

    // Create contract interface to encode function call
    const contractInterface = new ethers.utils.Interface(artifact.abi);
    const txData = contractInterface.encodeFunctionData('addRivet', [rivetAddressToAdd, rivetName]);

    // Estimate gas for the addRivet transaction
    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await provider.estimateGas({
        from: signerAddress,
        to: contractAddress,
        data: txData
      });
    } catch (error) {
      console.warn('Gas estimation failed for addRivet, using fallback');
      estimatedGas = ethers.BigNumber.from(100000);
    }

    const gasLimit = estimatedGas.mul(130).div(100);

    // Build Transaction
    const network = await provider.getNetwork();
    const nonce = await provider.getTransactionCount(signerAddress, 'pending');
    const feeData = await provider.getFeeData();

    const unsignedTx: any = {
      to: contractAddress,
      data: txData,
      value: '0x00',
      nonce: nonce,
      chainId: network.chainId,
      gasLimit: '0x' + gasLimit.toHexString().slice(2)
    };

    // Add gas pricing
    let totalTxCost: ethers.BigNumber;
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      let maxFee = feeData.maxFeePerGas.mul(120).div(100);
      let priorityFee = feeData.maxPriorityFeePerGas.mul(120).div(100);

      const isPolygon = network.chainId === 137 || network.chainId === 80002;
      if (isPolygon) {
        const minPriorityFee = ethers.utils.parseUnits('30', 'gwei');
        if (priorityFee.lt(minPriorityFee)) {
          priorityFee = minPriorityFee;
        }
        if (maxFee.lt(priorityFee)) {
          maxFee = priorityFee.mul(2);
        }
      }

      unsignedTx.maxFeePerGas = '0x' + maxFee.toHexString().slice(2);
      unsignedTx.maxPriorityFeePerGas = '0x' + priorityFee.toHexString().slice(2);
      unsignedTx.type = 2;

      totalTxCost = gasLimit.mul(maxFee);
    } else {
      const gasPrice = feeData.gasPrice!.mul(120).div(100);
      unsignedTx.gasPrice = '0x' + gasPrice.toHexString().slice(2);

      totalTxCost = gasLimit.mul(gasPrice);
    }

    // Fund Signer Wallet
    const signerBalance = await provider.getBalance(signerAddress);
    const neededWithBuffer = totalTxCost.mul(150).div(100);

    if (signerBalance.lt(neededWithBuffer)) {
      const amountToFund = neededWithBuffer.sub(signerBalance);

      const fundTxParams: any = {
        to: signerAddress,
        value: amountToFund,
        gasLimit: ethers.BigNumber.from(21000).mul(130).div(100)
      };

      if (unsignedTx.type === 2) {
        const isPolygon = network.chainId === 137 || network.chainId === 80002;
        const minPriorityFee = isPolygon ? ethers.utils.parseUnits('30', 'gwei') : ethers.BigNumber.from(unsignedTx.maxPriorityFeePerGas);
        fundTxParams.maxFeePerGas = unsignedTx.maxFeePerGas;
        fundTxParams.maxPriorityFeePerGas = minPriorityFee;
        fundTxParams.type = 2;
      } else {
        fundTxParams.gasPrice = unsignedTx.gasPrice;
      }

      const fundTx = await serverWallet.sendTransaction(fundTxParams);
      await fundTx.wait();
    }

    console.log(`Prepared addRivet transaction for ${signerAddress} to add ${rivetAddressToAdd}`);

    return {
      unsignedTransaction: unsignedTx,
      metadata: {
        operation: 'addRivetToContract',
        estimatedCost: ethers.utils.formatEther(gasLimit.mul(feeData.gasPrice || feeData.maxFeePerGas!)),
        signer: signerAddress,
        contractAddress: contractAddress,
        rivetToAdd: rivetAddressToAdd,
        rivetName: rivetName
      }
    };
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
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

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
