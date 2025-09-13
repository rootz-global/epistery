import { Request, Response } from 'express';
import { Controller } from '../baseController';
import tls from 'tls';
import * as acme from 'acme-client';
import { Epistery } from "../../epistery";
import { Utils } from '../../utils/index.js';


interface PendingCerts {
    [hostname: string]: boolean;
}

interface Challenges {
    [token: string]: string;
}

export class SSLController extends Controller {
    private pending: PendingCerts;
    private challenges: Challenges;
    private acme?: acme.Client;
    private epistery!: Epistery;

    constructor() {
        super();
        this.pending = {};
        this.challenges = {};
    }
    public index(req: Request, res: Response): void {
        const token = req.params.token;
        if (token in this.challenges) {
            res.writeHead(200);
            res.end(this.challenges[token]);
            return;
        }
        res.writeHead(302, {Location: `https://${req.headers.host}${req.url}`});
        res.end();
    }
    async initialize(): Promise<void> {
        if (!this.acme) {
            this.acme = new acme.Client({
                directoryUrl: acme.directory.letsencrypt[process.env.PROFILE === 'DEV' ? 'staging' : 'production'],
                accountKey: await acme.crypto.createPrivateKey(),
            });
        }
    }
    static get SNI(): { SNICallback: (hostname: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => void } {
        return {
            SNICallback: async (hostname: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
                const domain = Utils.GetDomainInfo(hostname);
                if (domain.ssl) {
                    cb(null, tls.createSecureContext({key: domain.ssl.key, cert: domain.ssl.cert}));
                } else {
                    cb(new Error(`${hostname} is unknown`));
                }
            }
        }
    }
    async getCert(servername: string, attempt: number = 0): Promise<void> {
        const domain = Utils.GetDomainInfo(servername);
        if (domain.ssl) {
            return;
        }
        if (servername in this.pending) {
            if (attempt >= 10) {
                throw new Error(`Gave up waiting on certificate for ${servername}`);
            }
            await new Promise((resolve) => {
                setTimeout(resolve, 1000);
            });
            await this.getCert(servername, (attempt + 1));
            return;
        }
        this.pending[servername] = true;
        const config = Utils.GetConfig();
        await this.initialize();
        //TODO: We need to restore the concept of profile in .epistery/config.ini
        if (!config.data.profile?.email) throw new Error(`cannot request certificate without "email" set in epistery/config.ini`);
        // create CSR
        const [key, csr] = await acme.crypto.createCsr({
            altNames: [servername],
        });
        // order certificate
        if (!this.acme) {
            throw new Error('ACME client not initialized');
        }
        const cert = await this.acme!.auto({
            csr,
            email: config.data.profile?.email,
            termsOfServiceAgreed: true,
            challengePriority: ['http-01'],
            challengeCreateFn: async (authz: any, challenge: any, keyAuthorization: string) => {
                this.challenges[challenge.token] = keyAuthorization;
            },
            challengeRemoveFn: async (authz: any, challenge: any) => {
                delete this.challenges[challenge.token];
            },
        });
        // save certificate
        domain.ssl = {cert: cert, key: key, modified: new Date()};
        config.saveDomain(servername, domain);
        delete this.pending[servername];
    }
}
