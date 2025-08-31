import {ethers,JsonRpcProvider} from '/.data-wallet/lib/ethers.js';
export default class DataWallet {
    constructor() {
        if (DataWallet.instance) return DataWallet.instance;
        DataWallet.instance = this;
        return this;
    }
    save() {
        localStorage.setItem('DataWallet', JSON.stringify(this));
    }

    load() {
        const data = localStorage.getItem('DataWallet');
        if (data) {
            const parsed = JSON.parse(data);
            Object.assign(this, parsed);
        }
    }
    static async connect() {
        let dataWallet = new DataWallet();
        dataWallet.load();
        try {
            let result = await fetch('/.data-wallet',{method:'GET',credentials:'include',headers:{'Content-Type':'application/json'}})
            if (result.ok) {
                // If this.server is already defined, what to do if it is now presenting different data?
                dataWallet.server = await result.json();
                if (dataWallet.server.provider) {
                    dataWallet.rpc = new JsonRpcProvider(dataWallet.server.provider.rpc);
                    if (!dataWallet.client) dataWallet.initialize();
                }
            }
        } catch(e) {
            console.error(e);
        }
        return dataWallet;
    }

    /**
     * Connect a client wallet for this domain. It should first check for plugin wallets that
     * can service the server's provider. The fallback to create a localStorage wallet
     */
    initialize() {
        let wallet = ethers.Wallet.createRandom(this.server.provider);
        this.client = {wallet: {
            address:wallet.address,
            mnemonic:wallet.mnemonic.phrase,
            publicKey:wallet.publicKey,
            privateKey:wallet.privateKey,
            signingKey:wallet.signingKey
        }};
        this.save();
    }
    async writeEvent(body) {
        // sign body with this.client.wallet. Include this.server.wallet for context
        let options = {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'}};
        options.body = JSON.stringify(body);
        let result = await fetch('/.data-wallet/data/',options);
    }
}
