import {ethers} from "ethers";
import { Utils } from '../dist/utils/Utils.js';
import { Epistery } from '../dist/epistery.js';

//TODO: This was hacked together. We need to refactor our wallet and config types and functions
export async function initialize(context, domain) {
    if (domain) {
        context.log(`Initializing domain ${domain} ...`);
        Epistery.initialize(context, domain);
        const domainConfig = Utils.GetDomainInfo(domain)
        domainConfig.wallet = Utils.InitServerWallet(domain);
        const config = Utils.GetConfig();
        config.saveDomain(domain,domainConfig);
        context.log(`configuration file written to ${config.configFile}`)
    } else {
        context.log(`Registration requires a domain name`);
    }
}
