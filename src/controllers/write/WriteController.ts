import { Request, Response } from 'express';
import { Controller } from '@baseController';
import { ethers } from 'ethers';
import { ClientWalletInfo, EpisteryWrite, HashResult, Utils, WalletConfig } from '@utils';
import { Aquafy } from '@utils/Aqua';
import { AquaTree } from 'aqua-js-sdk';
import { Epistery } from 'epistery';

export class WriteController extends Controller {
  constructor() {
    super();
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

      const episteryResponse:EpisteryWrite | null = await Epistery.write(clientWalletInfo, data);
      if (!episteryResponse)
        this.sendError(res, `Unable to create IPFS hash. Result: ${JSON.stringify(episteryResponse)}`, 500);
     
      this.sendResponse(res, episteryResponse);
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
