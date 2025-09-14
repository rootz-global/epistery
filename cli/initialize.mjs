import {ethers} from "ethers";
import { Utils } from '../dist/utils/Utils.js';
import { Epistery } from '../dist/epistery.js';

//TODO: This was hacked together. We need to refactor our wallet and config types and functions
export async function initialize(context, domain) {
    if (domain) {
        context.log(`Initializing domain ${domain} ...`);
        Epistery.initialize(context, domain);
        const domainConfig = Utils.GetDomainInfo(domain)
        const wallet = Utils.InitServerWallet(domain);
        domainConfig.wallet = {
            address: wallet.address,
            mnemonic: wallet.mnemonic.phrase,
            publicKey: wallet.publicKey,
            privateKey: wallet.privateKey,
            signingKey: wallet.signingKey
        };
        const config = Utils.GetConfig();
        config.saveDomain(domain,domainConfig);
        context.log(`configuration file written to ${config.configFile}`)
    } else {
        context.log(`Registration requires a domain name`);
    }
}
