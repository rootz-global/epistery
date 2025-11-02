import { ClientWalletInfo, DomainConfig, EpisteryStatus, EpisteryWrite, Utils, WalletConfig, KeyExchangeRequest, KeyExchangeResponse } from './utils/index.js';
import { ethers, Wallet } from 'ethers';
import { AquaTree } from 'aqua-js-sdk';
import { Aquafy } from './utils/Aqua.js';
import * as AgentArtifact from '../artifacts/contracts/agent.sol/Agent.json';
import * as crypto from 'crypto';

export class Epistery {
  private static ipfsApiUrl: string | undefined;
  private static ipfsGatewayUrl: string | undefined;
  private static isInitialized: boolean = false;

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

    const amount:ethers.BigNumber = ethers.utils.parseEther('0.0001');
    const serverHasEnough:boolean = await Utils.HasEnoughFunds(serverWallet, amount);
    if (!serverHasEnough) {
      console.log("Server wallet does not have enough funds.");
      return null;
    }

    const clientHasEnough:boolean = await Utils.HasEnoughFunds(clientWallet, amount);
    if (!clientHasEnough) {
      const fundTxnHash: string | null = await Utils.FundWallet(serverWallet, clientWallet, amount);
      if (!fundTxnHash) return null;
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

  /**
   * Verify a rivet key signature and its certificate chain
   * This validates:
   * 1. Certificate was signed by the claimed wallet
   * 2. Certificate hasn't expired
   * 3. Certificate is for the correct domain
   * 4. Rivet signature is valid using the certified public key
   *
   * @param payload - Object containing message, rivet signature, certificate, and certificate signature
   * @param domain - Expected domain for certificate validation
   * @returns Object with verification result and wallet address if valid
   */
  public static async verifyRivetSignature(
    payload: {
      message: string;
      rivetSignature: string;
      certificate: {
        rivetPublicKey: string;
        walletAddress: string;
        domain: string;
        issuedAt: number;
        expiresAt: number;
        permissions: string[];
        version: number;
      };
      certificateSignature: string;
      walletAddress: string;
    },
    domain: string
  ): Promise<{ valid: boolean; walletAddress?: string; error?: string }> {
    try {
      // 1. Verify the certificate was signed by the claimed wallet
      const certificateMessage = JSON.stringify(payload.certificate, null, 0);
      const certSigner = ethers.utils.verifyMessage(
        certificateMessage,
        payload.certificateSignature
      );

      if (certSigner.toLowerCase() !== payload.walletAddress.toLowerCase()) {
        return {
          valid: false,
          error: 'Certificate not signed by claimed wallet'
        };
      }

      // 2. Check certificate hasn't expired
      const now = Math.floor(Date.now() / 1000);
      if (payload.certificate.expiresAt < now) {
        return {
          valid: false,
          error: 'Rivet key certificate expired'
        };
      }

      // 3. Verify domain matches
      if (payload.certificate.domain !== domain) {
        return {
          valid: false,
          error: `Certificate domain mismatch. Expected: ${domain}, Got: ${payload.certificate.domain}`
        };
      }

      // 4. Verify the rivet signature using the certified P-256 public key
      const isValid = await this.verifyP256Signature(
        payload.message,
        payload.rivetSignature,
        payload.certificate.rivetPublicKey
      );

      if (!isValid) {
        return {
          valid: false,
          error: 'Rivet signature invalid'
        };
      }

      // All checks passed!
      return {
        valid: true,
        walletAddress: payload.walletAddress
      };

    } catch (error) {
      console.error('Rivet signature verification error:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown verification error'
      };
    }
  }

  /**
   * Verify a P-256 ECDSA signature
   * Used for validating rivet key signatures
   *
   * @param message - Original message that was signed
   * @param signatureHex - Hex-encoded signature
   * @param publicKeyHex - Hex-encoded SPKI public key
   * @returns true if signature is valid
   */
  private static async verifyP256Signature(
    message: string,
    signatureHex: string,
    publicKeyHex: string
  ): Promise<boolean> {
    try {
      // Remove '0x' prefix if present
      const signatureBuffer = Buffer.from(signatureHex.replace(/^0x/, ''), 'hex');
      const publicKeyBuffer = Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex');

      // Import the public key
      const publicKey = crypto.createPublicKey({
        key: publicKeyBuffer,
        format: 'der',
        type: 'spki'
      });

      // Create verifier
      const verify = crypto.createVerify('SHA256');
      verify.update(message);
      verify.end();

      // Verify signature
      const isValid = verify.verify(publicKey, signatureBuffer);

      return isValid;

    } catch (error) {
      console.error('P-256 signature verification error:', error);
      return false;
    }
  }
}
