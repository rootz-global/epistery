import { Request, Response } from 'express';
import { Controller } from '@baseController';
import { ethers } from 'ethers';
import { ClientWalletInfo, Utils, WalletConfig } from '@utils';
import { Aquafy } from '@utils/Aqua';
import { AquaTree } from 'aqua-js-sdk';

export class WriteController extends Controller {
  private ipfsApiUrl: string | undefined;

  constructor() {
    super();
    this.ipfsApiUrl = process.env.IPFS_URL ?? 'http://127.0.0.1:5001/api/v0';
    this.initIPFS();
  }

  private async initIPFS(): Promise<void> {
    try {
      const response = await fetch(`${this.ipfsApiUrl}/id`, { method: 'POST' });
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

  private async addToIPFS(data: string): Promise<{ Hash: string }> {
    const formData = new FormData();
    const blob = new Blob([data], { type: 'application/json' });
    formData.append('file', blob, 'data');

    const response = await fetch(`${this.ipfsApiUrl}/add`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed with status: ${response.status}`);
    }

    const result = await response.json() as { Hash: string };
    return result;
  }

  public async index(req: Request, res: Response) {
    try {
      const data = req.body;
      if (!data || Object.keys(data).length === 0) {
        return this.sendError(res, 'Request body is empty. Please provide data to sign and store.', 400);
      }

      // Use either user-given wallet or a generated data-wallet 
      let clientWallet: ethers.Wallet;
      let clientWalletInfo:ClientWalletInfo;
      
      if (data.wallet && data.wallet.privateKey) {
        clientWalletInfo = data.wallet;
        clientWallet = new ethers.Wallet(clientWalletInfo.privateKey);
        console.log('Using provided wallet:', clientWallet.address);
      }
      else {
        clientWallet = ethers.Wallet.createRandom();
        clientWalletInfo = {
          address: clientWallet.address,
          mnemonic: (clientWallet as ethers.Wallet).mnemonic?.phrase || '',
          publicKey: clientWallet.publicKey,
          privateKey: clientWallet.privateKey,
        };
        console.log('Generated new wallet:', clientWallet.address);
      }
      
      // Get server info
      const domain:string = process.env.SERVER_DOMAIN || 'localhost';
      const serverWallet:WalletConfig | undefined = Utils.GetDomainInfo(domain)?.wallet;

      // Aquafy the message
      const dataString:string = JSON.stringify(data);
      const aquaTree:AquaTree | undefined = await Aquafy(dataString, clientWalletInfo);
      
      if (aquaTree === undefined) {
        return this.sendError(res, "Aqua Tree is undefined.", 400);
      }
      
      // Create message hash and sign it
      const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(aquaTree)));
      const signature = await clientWallet.signMessage(messageHash);

      // Create the JSON object to store in IPFS
      const ipfsData = {
        data: data,
        aquaTree: aquaTree,
        signature: signature,
        messageHash: messageHash,
        client: {
          address: clientWallet.address,
          publicKey: clientWalletInfo.publicKey
        },
        server: {
          address: serverWallet?.address,
          domain: domain
        },
        timestamp: new Date().toISOString(),
        signedBy: clientWallet.address
      };

      // Upload to IPFS
      const jsonString = JSON.stringify(ipfsData, null, 2);
      const result = await this.addToIPFS(jsonString);
      
      if (result?.Hash) {
        const response = {
          success: true,
          aquaTree: aquaTree,
          ipfsHash: result.Hash,
          dataSize: jsonString.length,
          signature: signature,
          messageHash: messageHash,
          signedBy: clientWallet.address,
          timestamp: ipfsData.timestamp,
          ipfsUrl: `https://ipfs.io/ipfs/${result.Hash}`,
          wallet: clientWalletInfo
        };

        this.sendResponse(res, response);
      } 
      else {
        this.sendError(res, `Unable to create IPFS hash. Result: ${JSON.stringify(result)}`, 500);
      }
    }
    catch (error: any) {
      console.error('Error in WriteController:', error);
      
      if (error.message?.includes('ECONNREFUSED')) {
        return this.sendError(res, 'IPFS node not running. Please start IPFS daemon.', 503);
      }
      
      this.sendError(res, `Failed to process and store data: ${error.message}`, 500);
    }
  }
}
