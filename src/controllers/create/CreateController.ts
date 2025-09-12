import { Request, Response } from 'express';
import { Controller } from '../baseController';
import { Epistery } from 'epistery';
import { ClientWalletInfo } from '../../utils/index.js';

export class CreateController extends Controller {
  public index(req: Request, res: Response) {
    const walletInfo:ClientWalletInfo = Epistery.createWallet();
    const clientCookie = {
      wallet: walletInfo
    };

    this.setCookie(res, 'epistery-client', clientCookie);
    this.sendResponse(res, clientCookie);
  }
}
