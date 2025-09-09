import { Request, Response } from 'express';
import { Controller } from '../baseController';
import { ethers } from 'ethers'

export class CreateController extends Controller {
  public index(req: Request, res: Response) {
    const wallet = ethers.Wallet.createRandom();
    const walletInfo = {
      address: wallet.address,
      mnemonic: wallet.mnemonic?.phrase || '',
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      signingKey: wallet.signingKey
    };
    const clientCookie = {
      wallet: walletInfo
    };

    this.setCookie(res, 'epistery-client', clientCookie);
    this.sendResponse(res, clientCookie);
  }
}
