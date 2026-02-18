import {
  ClientWalletInfo,
  DomainConfig,
  EpisteryStatus,
  EpisteryWrite,
  Utils,
  WalletConfig,
  KeyExchangeRequest,
  KeyExchangeResponse,
  UnsignedTransaction,
  PrepareTransactionRequest,
  PrepareTransactionResponse,
  SubmitSignedTransactionRequest,
  SubmitSignedTransactionResponse,
  NotabotEvent,
  NotabotCommitment,
  NotabotScore,
  NotabotCommitRequest,
  RivetItem,
  Visibility,
  SendMessageRequest,
  CreatePostRequest
} from './utils/index.js';
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

    // Read operations don't require signing - just need address
    try {
      const result = await Utils.ReadFromContract(provider, clientWalletInfo.address);
      return result;
    }
    catch (error) {
      throw error;
    }
  }

  public static async write(clientWalletInfo: ClientWalletInfo, data: any): Promise<EpisteryWrite | null> {
    // Create real wallet from client info
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

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
    //const aquaTree: AquaTree | undefined = await Aquafy(dataString, clientWalletInfo);

    /* if (aquaTree === undefined) {
      console.error("Aqua Tree is undefined.");
      return null;
    } */

    // Create message hash and sign it
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataString));
    const signature = await clientWallet.signMessage(messageHash);

    // Create the JSON object to store in IPFS
    let ipfsData: EpisteryWrite = {
      data: data,
      aquaTree: undefined,
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
    catch (error) {
      throw error;
    }

  }

  /**
    * Returns true if successfully transferred ownership, else false
  */
  public static async transferOwnership(clientWalletInfo: ClientWalletInfo, futureOwnerWalletAddress: string, contractAddress?: string): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const receipts = await Utils.TransferOwnership(clientWallet, futureOwnerWalletAddress, contractAddress);
      if (!receipts || receipts.length === 0) return false;

      // Return detailed results
      return {
        success: true,
        transfers: receipts
      };
    }
    catch (error) {
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

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

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
    catch (error) {
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

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    try {
      const approvals = await Utils.GetApprovalsByAddress(clientWallet, approverAddress, requestorAddress);
      return approvals;
    }
    catch (error) {
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

    // Read operations don't require signing - just need address
    try {
      const approvals = await Utils.GetAllApprovalsForApprover(provider, approverAddress);
      return approvals;
    }
    catch (error) {
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

    // Read operations don't require signing - just need address
    try {
      const approvals = await Utils.GetAllApprovalsForRequestor(provider, requestorAddress);
      return approvals;
    }
    catch (error) {
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

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

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
    catch (error) {
      throw error;
    }
  }

  // ============================================================================
  // RIVET ITEM METHODS
  // Messages and Posts using the new RivetItem structure
  // ============================================================================

  /**
   * Send a direct message to another address
   * Uses server-side signing (requires mnemonic)
   * @param clientWalletInfo - Sender's wallet info
   * @param to - Recipient address
   * @param data - Message content (will be stored in IPFS)
   * @param metadata - Optional metadata for the message
   */
  public static async sendMessage(
    clientWalletInfo: ClientWalletInfo,
    to: string,
    data: any,
    metadata: string = ''
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

    const clientWallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    const domain = process.env.SERVER_DOMAIN || 'localhost';
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Create message data and upload to IPFS
    const messageData = {
      content: data,
      metadata: metadata,
      from: clientWallet.address,
      to: to,
      timestamp: new Date().toISOString()
    };

    const jsonString = JSON.stringify(messageData, null, 2);
    const ipfsHash = await Epistery.addToIPFS(jsonString);

    if (!ipfsHash) {
      throw new Error('Failed to upload message to IPFS');
    }

    // Estimate gas for the operation
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress) {
      throw new Error('Agent contract address not configured');
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      clientWallet
    );

    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.sendMessage(
        to,
        clientWallet.publicKey,
        metadata,
        domain,
        ipfsHash
      );
    } catch (error) {
      estimatedGas = ethers.BigNumber.from(Epistery.FALLBACK_GAS_LIMIT);
    }

    // Ensure client wallet is funded
    const isFunded = await Utils.EnsureFunded(serverWallet, clientWallet, estimatedGas);
    if (!isFunded) {
      throw new Error('Failed to ensure client wallet has sufficient funds');
    }

    // Send the message
    const receipt = await Utils.SendMessage(
      clientWallet,
      to,
      clientWallet.publicKey,
      metadata,
      domain,
      ipfsHash
    );

    return {
      receipt,
      ipfsHash,
      ipfsUrl: `${Epistery.ipfsGatewayUrl}/ipfs/${ipfsHash}`,
      from: clientWallet.address,
      to: to,
      timestamp: messageData.timestamp
    };
  }

  /**
   * Create a post on a board
   * Uses server-side signing (requires mnemonic)
   * @param clientWalletInfo - Poster's wallet info
   * @param board - Board address (can be own address or another's)
   * @param data - Post content (will be stored in IPFS)
   * @param visibility - Public or Private
   * @param metadata - Optional metadata for the post
   */
  public static async createPost(
    clientWalletInfo: ClientWalletInfo,
    board: string,
    data: any,
    visibility: Visibility = Visibility.Public,
    metadata: string = ''
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    if (!clientWalletInfo.mnemonic) {
      throw new Error('Mnemonic is required for server-side signing operations');
    }

    const clientWallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic).connect(provider);

    const domain = process.env.SERVER_DOMAIN || 'localhost';
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Create post data and upload to IPFS
    const postData = {
      content: data,
      metadata: metadata,
      from: clientWallet.address,
      board: board,
      visibility: visibility === Visibility.Public ? 'public' : 'private',
      timestamp: new Date().toISOString()
    };

    const jsonString = JSON.stringify(postData, null, 2);
    const ipfsHash = await Epistery.addToIPFS(jsonString);

    if (!ipfsHash) {
      throw new Error('Failed to upload post to IPFS');
    }

    // Estimate gas for the operation
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress) {
      throw new Error('Agent contract address not configured');
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      clientWallet
    );

    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.createPost(
        board,
        clientWallet.publicKey,
        metadata,
        domain,
        ipfsHash,
        visibility
      );
    } catch (error) {
      estimatedGas = ethers.BigNumber.from(Epistery.FALLBACK_GAS_LIMIT);
    }

    // Ensure client wallet is funded
    const isFunded = await Utils.EnsureFunded(serverWallet, clientWallet, estimatedGas);
    if (!isFunded) {
      throw new Error('Failed to ensure client wallet has sufficient funds');
    }

    // Create the post
    const receipt = await Utils.CreatePost(
      clientWallet,
      board,
      clientWallet.publicKey,
      metadata,
      domain,
      ipfsHash,
      visibility
    );

    return {
      receipt,
      ipfsHash,
      ipfsUrl: `${Epistery.ipfsGatewayUrl}/ipfs/${ipfsHash}`,
      from: clientWallet.address,
      board: board,
      visibility: visibility === Visibility.Public ? 'public' : 'private',
      timestamp: postData.timestamp
    };
  }

  /**
   * Get conversation messages between the caller and another party
   * @param clientWalletInfo - Caller's wallet info
   * @param otherParty - Other participant's address
   * @returns Array of RivetItems with IPFS content fetched
   */
  public static async getConversation(
    clientWalletInfo: ClientWalletInfo,
    otherParty: string
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get messages from contract
    const messages = await Utils.GetConversation(provider, clientWalletInfo.address, otherParty);

    // Fetch IPFS content for each message
    const messagesWithContent = await Promise.all(
      messages.map(async (msg: RivetItem) => {
        let content = null;
        let error = null;

        if (msg.ipfsHash) {
          try {
            const ipfsUrl = `${Epistery.ipfsGatewayUrl}/ipfs/${msg.ipfsHash}`;
            const response = await fetch(ipfsUrl);
            if (response.ok) {
              content = await response.json();
            } else {
              error = `Failed to fetch: ${response.status}`;
            }
          } catch (e) {
            error = e instanceof Error ? e.message : 'Unknown error';
          }
        }

        return {
          ...msg,
          ipfsUrl: msg.ipfsHash ? `${Epistery.ipfsGatewayUrl}/ipfs/${msg.ipfsHash}` : null,
          content,
          error
        };
      })
    );

    return {
      otherParty,
      callerAddress: clientWalletInfo.address,
      messages: messagesWithContent,
      count: messages.length
    };
  }

  /**
   * Get posts from a board
   * @param clientWalletInfo - Caller's wallet info (for visibility filtering)
   * @param board - Board address to get posts from
   * @param offset - Optional pagination offset
   * @param limit - Optional pagination limit
   * @returns Array of RivetItems with IPFS content fetched
   */
  public static async getPosts(
    clientWalletInfo: ClientWalletInfo,
    board: string,
    offset?: number,
    limit?: number
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get posts from contract
    let posts: RivetItem[];
    if (offset !== undefined && limit !== undefined) {
      posts = await Utils.GetPostsPaginated(provider, clientWalletInfo.address, board, offset, limit);
    } else {
      posts = await Utils.GetPosts(provider, clientWalletInfo.address, board);
    }

    // Fetch IPFS content for each post
    const postsWithContent = await Promise.all(
      posts.map(async (post: RivetItem) => {
        let content = null;
        let error = null;

        if (post.ipfsHash) {
          try {
            const ipfsUrl = `${Epistery.ipfsGatewayUrl}/ipfs/${post.ipfsHash}`;
            const response = await fetch(ipfsUrl);
            if (response.ok) {
              content = await response.json();
            } else {
              error = `Failed to fetch: ${response.status}`;
            }
          } catch (e) {
            error = e instanceof Error ? e.message : 'Unknown error';
          }
        }

        return {
          ...post,
          ipfsUrl: post.ipfsHash ? `${Epistery.ipfsGatewayUrl}/ipfs/${post.ipfsHash}` : null,
          content,
          error
        };
      })
    );

    return {
      board,
      callerAddress: clientWalletInfo.address,
      posts: postsWithContent,
      count: posts.length
    };
  }

  /**
   * Get all conversation IDs for a user
   * @param clientWalletInfo - User's wallet info
   * @returns Array of conversation IDs
   */
  public static async getUserConversations(
    clientWalletInfo: ClientWalletInfo
  ): Promise<string[]> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    return await Utils.GetUserConversationIds(provider, clientWalletInfo.address);
  }

  /**
   * Get the deterministic conversation ID for two addresses
   * Pure function, no blockchain access needed
   */
  public static getConversationId(addr1: string, addr2: string): string {
    return Utils.GetConversationId(addr1, addr2);
  }

  /**
   * Get public keys for an address
   * @param address - Address to get public keys for
   * @returns Array of public keys
   */
  public static async getPublicKeys(address: string): Promise<string[]> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);
    return await Utils.GetPublicKeys(provider, address);
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
        profile: undefined
      };

      return response;

    } catch (error) {
      console.error('Key exchange error:', error);
      return null;
    }
  }

  /**
   * Client-Side Signing Methods
   *
   * These methods prepare unsigned transactions for data-wallets to sign.
   * They handle IPFS uploads, gas estimation, and wallet funding, but do NOT
   * sign transactions - that happens client-side.
   */

  /**
   * Prepares an unsigned "write" transaction
   *
   * Flow:
   * 1. Upload data to IPFS (server-side, doesn't need private key)
   * 2. Ensure client has gas funds (server funds if needed)
   * 3. Estimate gas for contract.write()
   * 4. Build unsigned transaction object
   *
   * @param clientAddress - Client's wallet address
   * @param publicKey - Client's public key
   * @param data - Data to write
   * @returns Unsigned transaction ready for client to sign
   */
  public static async prepareWrite(
    clientAddress: string,
    publicKey: string,
    data: any
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get server wallet for funding operations
    const domain = process.env.SERVER_DOMAIN || 'localhost';
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    const dataString = JSON.stringify(data);
    //const aquaTree = await Aquafy(dataString, { address: clientAddress, publicKey });

    /* if (!aquaTree) {
      throw new Error('Failed to create Aqua tree');
    } */

    // Create message hash and signature placeholder (will be replaced by client)
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataString));

    // Create IPFS data structure
    const ipfsData: EpisteryWrite = {
      data: data,
      aquaTree: undefined,
      signature: '0x00', // Placeholder - client will sign this data separately
      messageHash: messageHash,
      client: {
        address: clientAddress,
        publicKey: publicKey
      },
      server: {
        address: serverWallet.address,
        domain: domain
      },
      timestamp: new Date().toISOString(),
      signedBy: clientAddress,
      ipfsHash: undefined,
      ipfsUrl: undefined,
    };

    // Upload to IPFS
    const jsonString = JSON.stringify(ipfsData, null, 2);
    const ipfsHash = await Epistery.addToIPFS(jsonString);

    if (!ipfsHash) {
      throw new Error('Failed to upload to IPFS');
    }

    // Setup contract for execution
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Agent contract address not configured');
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      provider  // Read-only provider, no signer
    );

    // Estimate gas for contract/transactions
    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.write(publicKey, ipfsHash, {
        from: clientAddress  // Simulate as if client is calling
      });
    }
    catch (error) {
      console.warn('Gas estimation failed, using fallback:', error);
      estimatedGas = ethers.BigNumber.from(200000);
    }

    // Add 30% buffer to gas estimate
    const gasLimit = estimatedGas.mul(130).div(100);

    // Build unsigned transaction (before funding to know exact cost)
    const network = await provider.getNetwork();
    const nonce = await provider.getTransactionCount(clientAddress, 'pending');
    const feeData = await provider.getFeeData();

    // Encode function call
    const txData = agentContract.interface.encodeFunctionData('write', [publicKey, ipfsHash]);

    // Build transaction object
    const unsignedTx: any = {
      to: agentContractAddress,
      data: txData,
      value: '0x00',
      nonce: nonce,
      chainId: network.chainId,
      gasLimit: '0x' + gasLimit.toHexString().slice(2)
    };

    // Add gas pricing based on network support
    let totalTxCost: ethers.BigNumber;
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      let maxFee = feeData.maxFeePerGas.mul(120).div(100);
      let priorityFee = feeData.maxPriorityFeePerGas.mul(120).div(100);

      // Polygon networks require higher **MINIMUM** priority fees
      const isPolygon = network.chainId === 137 || network.chainId === 80002;
      if (isPolygon) {
        const minPriorityFee = ethers.utils.parseUnits('30', 'gwei');
        if (priorityFee.lt(minPriorityFee)) {
          priorityFee = minPriorityFee;
        }
        // Ensure maxFeePerGas is at least priorityFee + base fee
        if (maxFee.lt(priorityFee)) {
          maxFee = priorityFee.mul(2); // Set to 2x priority fee as safety margin; Ensures the TX always execs
        }
      }

      unsignedTx.maxFeePerGas = '0x' + maxFee.toHexString().slice(2);
      unsignedTx.maxPriorityFeePerGas = '0x' + priorityFee.toHexString().slice(2);
      unsignedTx.type = 2;  // EIP-1559 transaction type

      // Calculate total cost using maxFeePerGas
      totalTxCost = gasLimit.mul(maxFee);
    }
    else {
      // Legacy gas pricing
      const gasPrice = feeData.gasPrice!.mul(120).div(100);
      unsignedTx.gasPrice = '0x' + gasPrice.toHexString().slice(2);

      // Calculate total cost using gasPrice
      totalTxCost = gasLimit.mul(gasPrice);
    }

    // Fund Client Wallet with exact amount needed
    // Check if client has enough balance for this specific transaction
    const clientBalance = await provider.getBalance(clientAddress);
    const neededWithBuffer = totalTxCost.mul(150).div(100);  // 50% safety buffer

    if (clientBalance.lt(neededWithBuffer)) {
      const amountToFund = neededWithBuffer.sub(clientBalance);
      console.log(`Client needs funding: ${ethers.utils.formatEther(amountToFund)} MATIC`);

      // Build funding transaction with proper gas params
      const fundTxParams: any = {
        to: clientAddress,
        value: amountToFund,
        gasLimit: ethers.BigNumber.from(21000).mul(130).div(100)
      };

      // Use same gas parameters as main transaction
      if (unsignedTx.type === 2) {
        // EIP-1559 - use the same gas params we calculated
        const isPolygon = network.chainId === 137 || network.chainId === 80002;
        const minPriorityFee = isPolygon ? ethers.utils.parseUnits('30', 'gwei') : ethers.BigNumber.from(unsignedTx.maxPriorityFeePerGas);

        fundTxParams.maxFeePerGas = unsignedTx.maxFeePerGas;
        fundTxParams.maxPriorityFeePerGas = minPriorityFee;
        fundTxParams.type = 2;
      } else {
        // Legacy - use the gas price we calculated
        fundTxParams.gasPrice = unsignedTx.gasPrice;
      }

      const fundTx = await serverWallet.sendTransaction(fundTxParams);
      console.log(`Funding transaction sent: ${fundTx.hash}`);
      await fundTx.wait();
      console.log(`Client wallet funded successfully`);
    } else {
      console.log(`Client has sufficient funds: ${ethers.utils.formatEther(clientBalance)} MATIC`);
    }

    console.log(`Prepared write transaction for ${clientAddress}`);
    console.log(`  IPFS Hash: ${ipfsHash}`);
    console.log(`  Gas Limit: ${gasLimit.toString()}`);
    console.log(`  Nonce: ${nonce}`);

    return {
      unsignedTransaction: unsignedTx,
      ipfsHash: ipfsHash,
      metadata: {
        operation: 'write',
        estimatedCost: ethers.utils.formatEther(gasLimit.mul(feeData.gasPrice || feeData.maxFeePerGas!)),
        ipfsUrl: `${Epistery.ipfsGatewayUrl}/ipfs/${ipfsHash}`
      }
    };
  }

  /**
   * Prepares an unsigned "transferOwnership" transaction
   *
   * @param clientAddress - Current owner's address
   * @param futureOwnerAddress - New owner's address
   * @returns Unsigned transaction ready for client to sign
   */
  public static async prepareTransferOwnership(
    clientAddress: string,
    futureOwnerAddress: string,
    contractAddress?: string
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get server wallet for funding
    const domain = process.env.SERVER_DOMAIN || 'localhost';
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    const network = await provider.getNetwork();
    const feeData = await provider.getFeeData();
    let currentNonce = await provider.getTransactionCount(clientAddress, 'pending');

    const transactions: any[] = [];
    let totalCostNeeded = ethers.BigNumber.from(0);

    // STEP 1: Always prepare Agent contract transaction
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Agent contract address not configured');
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      provider
    );

    // Gas Estimation for Agent transfer
    let agentGasLimit: ethers.BigNumber;
    try {
      const estimatedGas = await agentContract.estimateGas.transferOwnership(futureOwnerAddress, {
        from: clientAddress
      });
      agentGasLimit = estimatedGas.mul(130).div(100);
    } catch (error) {
      console.warn('Agent gas estimation failed (may have no data), using fallback');
      agentGasLimit = ethers.BigNumber.from(150000);
    }

    const agentTxData = agentContract.interface.encodeFunctionData('transferOwnership', [futureOwnerAddress]);

    const agentUnsignedTx: any = {
      to: agentContractAddress,
      data: agentTxData,
      value: '0x00',
      nonce: currentNonce,
      chainId: network.chainId,
      gasLimit: '0x' + agentGasLimit.toHexString().slice(2)
    };

    // Add gas pricing (EIP-1559 or legacy)
    let agentTxCost: ethers.BigNumber;
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

      agentUnsignedTx.maxFeePerGas = '0x' + maxFee.toHexString().slice(2);
      agentUnsignedTx.maxPriorityFeePerGas = '0x' + priorityFee.toHexString().slice(2);
      agentUnsignedTx.type = 2;

      agentTxCost = agentGasLimit.mul(maxFee);
    } else {
      const gasPrice = feeData.gasPrice!.mul(120).div(100);
      agentUnsignedTx.gasPrice = '0x' + gasPrice.toHexString().slice(2);

      agentTxCost = agentGasLimit.mul(gasPrice);
    }

    transactions.push({
      unsignedTransaction: agentUnsignedTx,
      metadata: {
        operation: 'transferOwnership',
        contractType: 'Agent',
        contractAddress: agentContractAddress,
        estimatedCost: ethers.utils.formatEther(agentTxCost),
        currentOwner: clientAddress,
        newOwner: futureOwnerAddress
      }
    });

    totalCostNeeded = totalCostNeeded.add(agentTxCost);
    currentNonce++;

    // STEP 2: If IdentityContract exists, also prepare IdentityContract transaction
    if (contractAddress) {
      const fs = await import('fs/promises');
      const path = await import('path');
      let artifactData: string;
      try {
        artifactData = await fs.readFile(path.join(__dirname, '..', 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json'), 'utf-8');
      } catch {
        artifactData = await fs.readFile(path.join(process.cwd(), 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json'), 'utf-8');
      }
      const identityArtifact = JSON.parse(artifactData);

      const identityContract = new ethers.Contract(
        contractAddress,
        identityArtifact.abi,
        provider
      );

      // Gas Estimation for IdentityContract transfer
      let identityGasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await identityContract.estimateGas.transferOwnership(futureOwnerAddress, {
          from: clientAddress
        });
        identityGasLimit = estimatedGas.mul(130).div(100);
      } catch (error) {
        console.warn('IdentityContract gas estimation failed, using fallback');
        identityGasLimit = ethers.BigNumber.from(100000);
      }

      const identityTxData = new ethers.utils.Interface(identityArtifact.abi).encodeFunctionData('transferOwnership', [futureOwnerAddress]);

      const identityUnsignedTx: any = {
        to: contractAddress,
        data: identityTxData,
        value: '0x00',
        nonce: currentNonce,
        chainId: network.chainId,
        gasLimit: '0x' + identityGasLimit.toHexString().slice(2)
      };

      // Add gas pricing (EIP-1559 or legacy)
      let identityTxCost: ethers.BigNumber;
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

        identityUnsignedTx.maxFeePerGas = '0x' + maxFee.toHexString().slice(2);
        identityUnsignedTx.maxPriorityFeePerGas = '0x' + priorityFee.toHexString().slice(2);
        identityUnsignedTx.type = 2;

        identityTxCost = identityGasLimit.mul(maxFee);
      } else {
        const gasPrice = feeData.gasPrice!.mul(120).div(100);
        identityUnsignedTx.gasPrice = '0x' + gasPrice.toHexString().slice(2);

        identityTxCost = identityGasLimit.mul(gasPrice);
      }

      transactions.push({
        unsignedTransaction: identityUnsignedTx,
        metadata: {
          operation: 'transferOwnership',
          contractType: 'IdentityContract',
          contractAddress: contractAddress,
          estimatedCost: ethers.utils.formatEther(identityTxCost),
          currentOwner: clientAddress,
          newOwner: futureOwnerAddress
        }
      });

      totalCostNeeded = totalCostNeeded.add(identityTxCost);
    }

    // Fund Client Wallet (for all transactions)
    const clientBalance = await provider.getBalance(clientAddress);
    const neededWithBuffer = totalCostNeeded.mul(150).div(100);

    if (clientBalance.lt(neededWithBuffer)) {
      const amountToFund = neededWithBuffer.sub(clientBalance);

      const fundTxParams: any = {
        to: clientAddress,
        value: amountToFund,
        gasLimit: ethers.BigNumber.from(21000).mul(130).div(100)
      };

      if (transactions[0].unsignedTransaction.type === 2) {
        const isPolygon = network.chainId === 137 || network.chainId === 80002;
        const minPriorityFee = isPolygon ? ethers.utils.parseUnits('30', 'gwei') : ethers.BigNumber.from(transactions[0].unsignedTransaction.maxPriorityFeePerGas);
        fundTxParams.maxFeePerGas = transactions[0].unsignedTransaction.maxFeePerGas;
        fundTxParams.maxPriorityFeePerGas = minPriorityFee;
        fundTxParams.type = 2;
      } else {
        fundTxParams.gasPrice = transactions[0].unsignedTransaction.gasPrice;
      }

      const fundTx = await serverWallet.sendTransaction(fundTxParams);
      await fundTx.wait();
    }

    console.log(`Prepared ${transactions.length} transferOwnership transaction(s) from ${clientAddress} to ${futureOwnerAddress}`);
    transactions.forEach((tx, idx) => {
      console.log(`  [${idx + 1}] ${tx.metadata.contractType} at ${tx.metadata.contractAddress}`);
    });

    return {
      transactions,
      totalEstimatedCost: ethers.utils.formatEther(totalCostNeeded)
    };
  }

  /**
   * Prepares an unsigned "createApproval" transaction
   *
   * @param clientAddress - Requestor's address
   * @param approverAddress - Address that will approve/deny
   * @param fileName - Name of file being requested
   * @param fileHash - Hash of file being requested
   * @param domain - Domain context
   * @returns Unsigned transaction ready for client to sign
   */
  public static async prepareCreateApproval(
    clientAddress: string,
    approverAddress: string,
    fileName: string,
    fileHash: string,
    domain: string
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get server wallet for funding
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Contract Setup
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Agent contract address not configured');
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      provider
    );

    // Gas Estimation
    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.createApproval(
        approverAddress,
        fileName,
        fileHash,
        domain,
        { from: clientAddress }
      );
    } catch (error) {
      console.warn('Gas estimation failed, using fallback');
      estimatedGas = ethers.BigNumber.from(200000);
    }

    const gasLimit = estimatedGas.mul(130).div(100);

    // Build Transaction (before funding so we know exact cost)
    const network = await provider.getNetwork();
    const nonce = await provider.getTransactionCount(clientAddress, 'pending');
    const feeData = await provider.getFeeData();

    const txData = agentContract.interface.encodeFunctionData('createApproval', [
      approverAddress,
      fileName,
      fileHash,
      domain
    ]);

    const unsignedTx: any = {
      to: agentContractAddress,
      data: txData,
      value: '0x00',
      nonce: nonce,
      chainId: network.chainId,
      gasLimit: '0x' + gasLimit.toHexString().slice(2)
    };

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

    // Fund Client Wallet
    const clientBalance = await provider.getBalance(clientAddress);
    const neededWithBuffer = totalTxCost.mul(150).div(100);

    if (clientBalance.lt(neededWithBuffer)) {
      const amountToFund = neededWithBuffer.sub(clientBalance);

      const fundTxParams: any = {
        to: clientAddress,
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

    console.log(`Prepared createApproval transaction: ${clientAddress} → ${approverAddress} for ${fileName}`);

    return {
      unsignedTransaction: unsignedTx,
      metadata: {
        operation: 'createApproval',
        estimatedCost: ethers.utils.formatEther(gasLimit.mul(feeData.gasPrice || feeData.maxFeePerGas!)),
        requestor: clientAddress,
        approver: approverAddress,
        fileName: fileName,
        fileHash: fileHash,
        domain: domain
      }
    };
  }

  /**
   * Prepares an unsigned "handleApproval" transaction
   *
   * @param approverAddress - Approver's address (signer)
   * @param requestorAddress - Requestor's address
   * @param fileName - Name of file to approve/deny
   * @param approved - True to approve, false to deny
   * @param domain - Domain context
   * @returns Unsigned transaction ready for client to sign
   */
  public static async prepareHandleApproval(
    approverAddress: string,
    requestorAddress: string,
    fileName: string,
    approved: boolean,
    domain: string
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Get server wallet for funding
    const serverWalletConfig = Utils.GetDomainInfo(domain)?.wallet;
    if (!serverWalletConfig) {
      throw new Error('Server wallet not configured');
    }
    const serverWallet = ethers.Wallet.fromMnemonic(serverWalletConfig.mnemonic).connect(provider);

    // Contract Setup
    const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
    if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Agent contract address not configured');
    }

    const agentContract = new ethers.Contract(
      agentContractAddress,
      AgentArtifact.abi,
      provider
    );

    // Gas Estimation
    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await agentContract.estimateGas.handleApproval(
        requestorAddress,
        fileName,
        approved,
        { from: approverAddress }
      );
    } catch (error) {
      console.warn('Gas estimation failed, using fallback');
      estimatedGas = ethers.BigNumber.from(150000);
    }

    const gasLimit = estimatedGas.mul(130).div(100);

    // Build Transaction (before funding so we know exact cost)
    const network = await provider.getNetwork();
    const nonce = await provider.getTransactionCount(approverAddress, 'pending');
    const feeData = await provider.getFeeData();

    const txData = agentContract.interface.encodeFunctionData('handleApproval', [
      requestorAddress,
      fileName,
      approved
    ]);

    const unsignedTx: any = {
      to: agentContractAddress,
      data: txData,
      value: '0x00',
      nonce: nonce,
      chainId: network.chainId,
      gasLimit: '0x' + gasLimit.toHexString().slice(2)
    };

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

    // Fund Approver Wallet
    const approverBalance = await provider.getBalance(approverAddress);
    const neededWithBuffer = totalTxCost.mul(150).div(100);

    if (approverBalance.lt(neededWithBuffer)) {
      const amountToFund = neededWithBuffer.sub(approverBalance);

      const fundTxParams: any = {
        to: approverAddress,
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

    console.log(`Prepared handleApproval transaction: ${approverAddress} ${approved ? 'approving' : 'denying'} ${requestorAddress}/${fileName}`);

    return {
      unsignedTransaction: unsignedTx,
      metadata: {
        operation: 'handleApproval',
        estimatedCost: ethers.utils.formatEther(gasLimit.mul(feeData.gasPrice || feeData.maxFeePerGas!)),
        approver: approverAddress,
        requestor: requestorAddress,
        fileName: fileName,
        approved: approved
      }
    };
  }

  /**
   * Prepares an unsigned "deploy IdentityContract" transaction
   *
   * @param clientAddress - Deployer's address (will be contract owner)
   * @param domain - Domain context
   * @returns Unsigned deployment transaction ready for client to sign
   */
  public static async prepareDeployIdentityContract(
    clientAddress: string,
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

    // Create contract factory to get deployment bytecode (no signer needed for getting deployment tx)
    // IdentityContract constructor requires: constructor(string memory _name, string memory _domain)
    // - _name: Identity name
    // - _domain: Domain where identity is minted
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
    const deployTx = factory.getDeployTransaction(clientAddress, domain);

    // Estimate gas for contract deployment
    let estimatedGas: ethers.BigNumber;
    try {
      estimatedGas = await provider.estimateGas({
        ...deployTx,
        from: clientAddress
      });
    } catch (error) {
      console.warn('Gas estimation failed for contract deployment, using fallback');
      estimatedGas = ethers.BigNumber.from(750000);
    }

    const gasLimit = estimatedGas.mul(130).div(100);

    // Build Transaction
    const network = await provider.getNetwork();
    const nonce = await provider.getTransactionCount(clientAddress, 'pending');
    const feeData = await provider.getFeeData();

    const unsignedTx: any = {
      data: deployTx.data,
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

    // Fund Client Wallet
    const clientBalance = await provider.getBalance(clientAddress);
    const neededWithBuffer = totalTxCost.mul(150).div(100);

    if (clientBalance.lt(neededWithBuffer)) {
      const amountToFund = neededWithBuffer.sub(clientBalance);

      const fundTxParams: any = {
        to: clientAddress,
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

    console.log(`Prepared IdentityContract deployment transaction for ${clientAddress}`);

    return {
      unsignedTransaction: unsignedTx,
      metadata: {
        operation: 'deployIdentityContract',
        estimatedCost: ethers.utils.formatEther(gasLimit.mul(feeData.gasPrice || feeData.maxFeePerGas!)),
        deployer: clientAddress
      }
    };
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

  /**
   * Notabot Score System Methods
   * Based on US Patent 11,120,469 "Browser Proof of Work"
   */

  /**
   * Get notabot score for a rivet address
   * Retrieves commitment from identity contract
   *
   * @param rivetAddress - Address of the rivet to query
   * @param identityContractAddress - Optional identity contract address (if not using Agent)
   * @returns Notabot score data
   */
  public static async getNotabotScore(
    rivetAddress: string,
    identityContractAddress?: string
  ): Promise<NotabotScore> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // Load IdentityContract artifact
    const fs = await import('fs/promises');
    const path = await import('path');
    let artifactData: string;
    try {
      artifactData = await fs.readFile(path.join(__dirname, '..', 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json'), 'utf-8');
    } catch {
      artifactData = await fs.readFile(path.join(process.cwd(), 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json'), 'utf-8');
    }
    const artifact = JSON.parse(artifactData);

    if (!identityContractAddress) {
      // If no identity contract specified, try to get it from Agent contract
      // For now, return zero score if not found
      return {
        points: 0,
        eventCount: 0,
        lastUpdate: 0,
        verified: false
      };
    }

    // Create contract instance
    const contract = new ethers.Contract(
      identityContractAddress,
      artifact.abi,
      provider
    );

    try {
      // Query notabot score
      const commitment = await contract.getNotabotScore(rivetAddress);

      return {
        points: commitment.totalPoints.toNumber(),
        eventCount: commitment.eventCount.toNumber(),
        lastUpdate: commitment.lastUpdate.toNumber(),
        verified: true,
        commitment: {
          totalPoints: commitment.totalPoints.toNumber(),
          chainHead: commitment.chainHead,
          eventCount: commitment.eventCount.toNumber(),
          lastUpdate: commitment.lastUpdate.toNumber()
        }
      };
    } catch (error) {
      console.error('[Epistery] Failed to get notabot score:', error);
      return {
        points: 0,
        eventCount: 0,
        lastUpdate: 0,
        verified: false
      };
    }
  }

  /**
   * Verify integrity of a notabot event chain
   *
   * @param rivetAddress - Address that should have signed the events
   * @param eventChain - Array of events to verify
   * @returns True if chain is valid
   */
  public static async verifyNotabotChain(
    rivetAddress: string,
    eventChain: NotabotEvent[]
  ): Promise<boolean> {
    if (!eventChain || eventChain.length === 0) {
      return false;
    }

    try {
      // Verify each event's hash and signature
      for (let i = 0; i < eventChain.length; i++) {
        const event = eventChain[i];

        // Verify hash chain
        const expectedPreviousHash = i === 0
          ? '0x0000000000000000000000000000000000000000000000000000000000000000'
          : eventChain[i - 1].hash;

        if (event.previousHash !== expectedPreviousHash) {
          console.error(`[Epistery] Hash chain broken at event ${i}`);
          return false;
        }

        // Recalculate hash
        const data = `${event.previousHash}${event.timestamp}${event.eventType}${event.entropyScore}`;
        const calculatedHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data));

        if (calculatedHash !== event.hash) {
          console.error(`[Epistery] Hash mismatch at event ${i}`);
          return false;
        }

        // Verify signature
        const recoveredAddress = ethers.utils.verifyMessage(event.hash, event.signature);

        if (recoveredAddress.toLowerCase() !== rivetAddress.toLowerCase()) {
          console.error(`[Epistery] Signature verification failed at event ${i}`);
          console.error(`  Expected: ${rivetAddress}`);
          console.error(`  Got: ${recoveredAddress}`);
          return false;
        }

        // Verify entropy score is reasonable (0.0 - 1.0)
        if (event.entropyScore < 0 || event.entropyScore > 1.0) {
          console.error(`[Epistery] Invalid entropy score at event ${i}: ${event.entropyScore}`);
          return false;
        }
      }

      console.log(`[Epistery] Verified ${eventChain.length} notabot events`);
      return true;

    } catch (error) {
      console.error('[Epistery] Chain verification failed:', error);
      return false;
    }
  }

  /**
   * Commit notabot score to identity contract
   * Server-side method called from /.well-known/epistery/notabot/commit endpoint
   *
   * @param rivetAddress - Rivet making the commitment
   * @param rivetMnemonic - Rivet mnemonic for signing transaction
   * @param request - Commitment request with event chain for verification
   * @param identityContractAddress - Address of the identity contract
   * @returns Transaction receipt
   */
  public static async commitNotabotScore(
    rivetAddress: string,
    rivetMnemonic: string,
    request: NotabotCommitRequest,
    identityContractAddress: string
  ): Promise<any> {
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_URL);

    // First verify the event chain
    const isValid = await Epistery.verifyNotabotChain(rivetAddress, request.eventChain);
    if (!isValid) {
      throw new Error('Invalid event chain');
    }

    // Verify commitment matches chain
    const lastEvent = request.eventChain[request.eventChain.length - 1];
    if (request.commitment.chainHead !== lastEvent.hash) {
      throw new Error('Commitment chainHead does not match last event hash');
    }

    if (request.commitment.eventCount !== request.eventChain.length) {
      throw new Error('Commitment eventCount does not match chain length');
    }

    // Calculate total points from chain
    let calculatedPoints = 0;
    request.eventChain.forEach(event => {
      calculatedPoints += Math.floor(event.entropyScore * 10);
    });

    if (request.commitment.totalPoints !== calculatedPoints) {
      throw new Error(`Point mismatch: claimed ${request.commitment.totalPoints}, calculated ${calculatedPoints}`);
    }

    // Load IdentityContract artifact
    const fs = await import('fs/promises');
    const path = await import('path');
    let artifactData: string;
    try {
      artifactData = await fs.readFile(path.join(__dirname, '..', 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json'), 'utf-8');
    } catch {
      artifactData = await fs.readFile(path.join(process.cwd(), 'artifacts', 'contracts', 'IdentityContract.sol', 'IdentityContract.json'), 'utf-8');
    }
    const artifact = JSON.parse(artifactData);

    // Create wallet from mnemonic
    const rivetWallet = ethers.Wallet.fromMnemonic(rivetMnemonic).connect(provider);

    // Create contract instance
    const contract = new ethers.Contract(
      identityContractAddress,
      artifact.abi,
      rivetWallet
    );

    try {
      // Call updateNotabotScore
      const tx = await contract.updateNotabotScore(
        request.commitment.totalPoints,
        request.commitment.chainHead,
        request.commitment.eventCount
      );

      console.log(`[Epistery] Notabot commitment transaction: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[Epistery] Notabot score committed: ${request.commitment.totalPoints} points`);

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        points: request.commitment.totalPoints,
        eventCount: request.commitment.eventCount
      };

    } catch (error) {
      console.error('[Epistery] Failed to commit notabot score:', error);
      throw error;
    }
  }
}
