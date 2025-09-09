import { Request, Response } from 'express';
import { Controller } from '@baseController';
import { Utils } from '@utils';

export class StatusController extends Controller {
  public async index(req: Request, res: Response) {
    const rawClientCookie = this.getCookie(req, 'epistery-client');
    const clientCookie = rawClientCookie ? JSON.parse(rawClientCookie) : null;
    const domain: string = (process.env.SERVER_DOMAIN) as string;
    const serverWallet = Utils.GetDomainInfo(domain)?.wallet;
    const config = Utils.GetConfig();
    
    const statusObj = {
      server: {
        walletAddress: serverWallet?.address,
        publicKey: serverWallet?.publicKey,
        provider: config.data.provider.name,
        chainId: config.data.provider.chainId,
        rpc: config.data.provider.rpc
      },
      client: {
        walletAddress: clientCookie?.wallet?.address,
        publicKey: clientCookie?.wallet?.publicKey
      },
      timestamp: new Date().toISOString()
    }
    
    this.sendResponse(res, statusObj); 
  }
}
