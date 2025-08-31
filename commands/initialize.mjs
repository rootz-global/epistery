import {ethers} from "ethers";

export async function initialize(context,domain) {
    if (domain) {
        await context.epistery.setDomain(domain);
        context.log(`Registering ${domain} ...`);
        if (!context.epistery.domain.wallet) {
            let wallet = ethers.Wallet.createRandom(context.epistery.domain.provider);
            context.epistery.domain.wallet = {
                address: wallet.address,
                mnemonic: wallet.mnemonic.phrase,
                publicKey: wallet.publicKey,
                privateKey: wallet.privateKey,
                signingKey: wallet.signingKey
            };
            context.epistery.config.saveDomain(domain);
        }
    } else {
        context.log(`Registration requires a domain name`);
    }
}