import { ClientWalletInfo, DomainConfig, EpisteryStatus, EpisteryWrite, Utils, WalletConfig, KeyExchangeRequest, KeyExchangeResponse } from './utils/index.js';
import { ethers, Wallet } from 'ethers';
import { AquaTree } from 'aqua-js-sdk';
import { Aquafy } from './utils/Aqua.js';
import * as AgentArtifact from '../artifacts/contracts/agent.sol/Agent.json';

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

    const config = Utils.GetConfig();
    const rootConfig = config.read('/');
    Epistery.ipfsApiUrl = rootConfig.ipfs?.url || process.env.IPFS_URL as string || 'http://127.0.0.1:5001/api/v0';
    Epistery.ipfsGatewayUrl = rootConfig.ipfs?.gateway || 'http://localhost:8080';
    await Epistery.initIPFS();

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

  public static async read(clientWalletInfo: ClientWalletInfo): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const result = await Utils.ReadFromContract(clientWallet);
      return result;
    }
    catch(error) {
      throw error;
    }
  }

  public static async write(clientWalletInfo: ClientWalletInfo, data: any): Promise<EpisteryWrite | null> {
    // Create real wallet from client info
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    // TODO: The environment should not define the domain. The domain is in req.app.locals.epistery
    // Get server info
    const domain: string = process.env.SERVER_DOMAIN || 'localhost';
    const serverWalletConfig: WalletConfig | undefined = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig)
      return null;

    const serverWallet: Wallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Estimate gas for the write operation that will happen later
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      console.error('Agent contract address not configured');
      return null;
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      clientWallet
    );

    // Estimate gas for contract write
    let estimatedGas: ethers.BigNumber;
    try {
      // We need to estimate with a placeholder hash since we don't have the IPFS hash yet
      // Use a realistic placeholder that matches the actual hash length
      const placeholderHash = 'QmPlaceholderHashForGasEstimation1234567890';
      estimatedGas = await agentContract.estimateGas.write(clientWallet.publicKey, placeholderHash);
    } catch (error) {
      console.warn('Gas estimation failed, using default estimate');
      estimatedGas = ethers.BigNumber.from(Epistery.FALLBACK_GAS_LIMIT);
    }

    // Ensure client wallet is funded for the operation
    const isFunded = await Utils.EnsureFunded(serverWallet, clientWallet, estimatedGas);
    if (!isFunded) {
      console.error('Failed to ensure client wallet has sufficient funds');
      return null;
    }

    // Create Genesis block (self-transfer)
    /* const genesisTxnHash: string | null = await Epistery.completeGenesis(clientWallet);
    if (!genesisTxnHash)
      return null; */

    // Aquafy the message
    const dataString: string = JSON.stringify(data);
    const aquaTree: AquaTree | undefined = await Aquafy(dataString, clientWalletInfo);

    if (aquaTree === undefined) {
      console.error("Aqua Tree is undefined.");
      return null;
    }

    // Create message hash and sign it
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(aquaTree)));
    const signature = await clientWallet.signMessage(messageHash);

    // Create the JSON object to store in IPFS
    let ipfsData: EpisteryWrite = {
      data: data,
      aquaTree: aquaTree,
      signature: signature,
      messageHash: messageHash,
      client: {
        address: clientWallet?.address,
        publicKey: clientWalletInfo.publicKey
      },
      server: {
        address: serverWallet?.address,
        domain: domain
      },
      timestamp: new Date().toISOString(),
      signedBy: clientWallet.address,
      ipfsHash: undefined,
      ipfsUrl: undefined,
    };

    // Upload to IPFS
    const jsonString: string = JSON.stringify(ipfsData, null, 2);
    const hash: string | undefined = await Epistery.addToIPFS(jsonString);

    ipfsData.ipfsHash = hash;
    ipfsData.ipfsUrl = `${Epistery.ipfsGatewayUrl}/ipfs/${hash}`;

    // Write to Agent smart contract
    try {
      const receipt = await Utils.WriteToContract(clientWallet, hash);
      if (!receipt)
        throw new Error("Error while writing to contract. Receipt was null.");
      return ipfsData;
    }
    catch(error) {
      throw error;
    }

  }

  /**
    * Returns true if successfully transferred ownership, else false
  */
  public static async transferOwnership(clientWalletInfo: ClientWalletInfo, futureOwnerWalletAddress: string): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const receipt = await Utils.TransferOwnership(clientWallet, futureOwnerWalletAddress);
      if (!receipt) return false;
      return true;
    }
    catch(error) {
      throw error;
    }
  }

  /**
   * Creates a request for a file
   * @param clientWalletInfo The requestor's wallet information
   * @param approverAddress The address that will approve/deny the request
   * @param fileName The name of the file being requested
   * @param fileHash The hash of the file being requested
   * @param domain The domain to check whitelist against
   */
  public static async createApproval(clientWalletInfo: ClientWalletInfo, approverAddress: string, fileName: string, fileHash: string, domain: string): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    const serverWalletConfig: WalletConfig | undefined = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig)
      return null;

    const serverWallet: Wallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Estimate gas for the createApproval operation
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      console.error('Agent contract address not configured');
      return null;
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      clientWallet
    );

    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.createApproval(approverAddress, fileName, fileHash, domain);
    } catch (error) {
      console.warn('Gas estimation for createApproval failed, using default estimate');
      estimatedGas = ethers.BigNumber.from(Epistery.FALLBACK_GAS_LIMIT);
    }

    // Ensure client wallet is funded for the operation
    const isFunded = await Utils.EnsureFunded(serverWallet, clientWallet, estimatedGas);
    if (!isFunded) {
      console.error('Failed to ensure client wallet has sufficient funds');
      return null;
    }

    try {
      const receipt = await Utils.CreateApproval(clientWallet, approverAddress, fileName, fileHash, domain);
      if (!receipt) return false;
      return receipt;
    }
    catch(error) {
      throw error;
    }
  }

  /**
   * Gets all requests for a specific requestor from an approver
   * @param clientWalletInfo The wallet information to use for the query
   * @param approverAddress The address of the approver
   * @param requestorAddress The address of the requestor
   */
  public static async getApprovals(clientWalletInfo: ClientWalletInfo, approverAddress: string, requestorAddress: string): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const approvals = await Utils.GetApprovalsByAddress(clientWallet, approverAddress, requestorAddress);
      return approvals;
    }
    catch(error) {
      throw error;
    }
  }

  /**
   * Gets all requests for an approver from all requestors
   * @param clientWalletInfo The wallet information to use for the query
   * @param approverAddress The address of the approver
   */
  public static async getAllApprovalsForApprover(clientWalletInfo: ClientWalletInfo, approverAddress: string): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const approvals = await Utils.GetAllApprovalsForApprover(clientWallet, approverAddress);
      return approvals;
    }
    catch(error) {
      throw error;
    }
  }

  /**
   * Gets all requests for a requestor from all approvers
   * @param clientWalletInfo The wallet information to use for the query
   * @param requestorAddress The address of the requestor
   */
  public static async getAllApprovalsForRequestor(clientWalletInfo: ClientWalletInfo, requestorAddress: string): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const approvals = await Utils.GetAllApprovalsForRequestor(clientWallet, requestorAddress);
      return approvals;
    }
    catch(error) {
      throw error;
    }
  }

  /**
   * Handles a request (approve or deny)
   * @param clientWalletInfo The approver's wallet information
   * @param requestorAddress The address that requested the approval
   * @param fileName The name of the file to approve/deny
   * @param approved Whether to approve or deny the request
   */
  public static async handleApproval(clientWalletInfo: ClientWalletInfo, requestorAddress: string, fileName: string, approved: boolean): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    const domain: string = process.env.SERVER_DOMAIN || 'localhost';
    const serverWalletConfig: WalletConfig | undefined = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig)
      return null;

    const serverWallet: Wallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Estimate gas for the handleApproval operation
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      console.error('Agent contract address not configured');
      return null;
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      clientWallet
    );

    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.handleApproval(requestorAddress, fileName, approved);
    } catch (error) {
      console.warn('Gas estimation for handleApproval failed, using default estimate');
      estimatedGas = ethers.BigNumber.from(Epistery.FALLBACK_GAS_LIMIT);
    }

    // Ensure client wallet is funded for the operation
    const isFunded = await Utils.EnsureFunded(serverWallet, clientWallet, estimatedGas);
    if (!isFunded) {
      console.error('Failed to ensure client wallet has sufficient funds');
      return null;
    }

    try {
      const receipt = await Utils.HandleApproval(clientWallet, requestorAddress, fileName, approved);
      if (!receipt) return false;
      return receipt;
    }
    catch(error) {
      throw error;
    }
  }

  private static async initIPFS(): Promise<void> {
    try {
      console.log("IPFS Node URL:", Epistery.ipfsApiUrl);
      const response = await fetch(`${Epistery.ipfsApiUrl}/id`, { method: 'POST' });
      if (!response.ok) {
        console.error('IPFS node not responding properly');
        return;
      }
      console.log('IPFS node connected successfully');
    }
    catch (error) {
      console.error('IPFS node not running:', error);
    }
  }

  private static async addToIPFS(data: string): Promise<string | undefined> {
    const formData = new FormData();
    const blob = new Blob([data], { type: 'application/json' });
    formData.append('file', blob, 'data');

    const response = await fetch(`${Epistery.ipfsApiUrl}/add`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      console.error(`IPFS upload failed with status: ${response.status}`);
      return undefined;
    }

    const result: any = await response.json();
    if (!result)
      return undefined;

    return result.Hash;
  }

  public static async handleKeyExchange(request: KeyExchangeRequest, serverWallet: WalletConfig): Promise<KeyExchangeResponse | null> {
    try {
      // Verify client's identity by checking signature
      const expectedMessage = `Epistery Key Exchange - ${request.clientAddress} - ${request.challenge}`;

      if (request.message !== expectedMessage) {
        console.error('Key exchange message mismatch');
        console.error('Expected:', expectedMessage);
        console.error('Received:', request.message);
        return null;
      }

      // Verify the signature matches the client's address
      const recoveredAddress = ethers.utils.verifyMessage(request.message, request.signature);

      if (recoveredAddress.toLowerCase() !== request.clientAddress.toLowerCase()) {
        console.error('Client identity verification failed');
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
        profile:undefined
      };

      return response;

    } catch (error) {
      console.error('Key exchange error:', error);
      return null;
    }
  }
}
