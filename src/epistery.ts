import { ethers } from 'ethers';
import { ClientWalletInfo, DomainConfig, EpisteryStatus, EpisteryWrite, HashResult, Utils, WalletConfig, KeyExchangeRequest, KeyExchangeResponse } from './utils/index.js';
import { AquaTree } from 'aqua-js-sdk';
import { Aquafy } from './utils/Aqua.js';

export class Epistery {
  private static ipfsApiUrl: string | undefined;
  private static isInitialized: boolean = false;

  constructor() {}

  public static async initialize(): Promise<void> {
    if (Epistery.isInitialized)
      return;

    const config = Utils.GetConfig()
    Epistery.ipfsApiUrl = config.data.ipfs?.url || process.env.IPFS_URL as string || 'http://127.0.0.1:5001/api/v0';
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
    const status: EpisteryStatus = {
      server: {
        walletAddress: server?.wallet?.address,
        publicKey: server?.wallet?.publicKey,
        provider: server?.provider?.name,
        chainId: server?.provider?.chainId,
        rpc: server?.provider?.rpc
      },
      client: {
        walletAddress: client?.address,
        publicKey: client?.publicKey
      },
      timestamp: new Date().toISOString()
    }

    return status;
  }

  public static async write(clientWalletInfo: ClientWalletInfo, data: any): Promise<EpisteryWrite | null> {
    // Create real wallet from client info
    const clientWallet: ethers.Wallet = ethers.Wallet.fromMnemonic(clientWalletInfo.mnemonic);

    // TODO: The environment should not define the domain. The domain is in req.app.locals.epistery
    // Get server info
    const domain: string = process.env.SERVER_DOMAIN || 'localhost';
    const serverWallet: WalletConfig | undefined = Utils.GetDomainInfo(domain).wallet;

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
    const jsonString:string = JSON.stringify(ipfsData, null, 2);
    const hash:string | undefined = await Epistery.addToIPFS(jsonString);

    ipfsData.ipfsHash = hash;
    ipfsData.ipfsUrl = `http://localhost:8080/ipfs/${hash}`;

    return ipfsData;
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

    const result:any = await response.json();
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
