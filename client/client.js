import DataWallet from '/.data-wallet/lib/datawallet.js';

(async ()=>{
    const dataWallet = await DataWallet.connect();
    await dataWallet.writeEvent({event:'pageload',url:location.href,domain:location.hostname});
    window.DataWallet = DataWallet;
})()
