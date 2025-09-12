import { Request, Response } from 'express';
import { Controller } from '../baseController.js';
import { Config, ClientWalletInfo, Utils, DomainConfig } from '../../utils/index.js';
import { Epistery } from 'epistery';

export class StatusController extends Controller {
  public async index(req: Request, res: Response) {
    const config:Config = Utils.GetConfig();
    const domain: string = config.activeDomain.domain;
    const rawClientCookie:any = this.getCookie(req, 'epistery-client');
    const clientCookie:any = rawClientCookie ? JSON.parse(rawClientCookie) : null;
    const clientWallet:ClientWalletInfo = {
      address: clientCookie?.wallet?.address,
      mnemonic: clientCookie?.wallet?.mnemonic,
      publicKey: clientCookie?.wallet?.publicKey,
      privateKey: clientCookie?.wallet?.privateKey,
    }
    const serverWallet:DomainConfig | null = Utils.GetDomainInfo(domain);
    if (!serverWallet) {
      this.sendError(res, "Unable to load server wallet.", 400);
      return;
    }

    const status = Epistery.getStatus(clientWallet, serverWallet);
    this.sendResponse(res, status);
  }
}
