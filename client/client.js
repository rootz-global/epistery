import Witness from '/.epistery/lib/witness.js';

(async ()=>{
  console.log('Client started');
    const witness = await Witness.connect();
    await witness.writeEvent({event:'pageload',url:location.href,domain:location.hostname});
    window.witness = witness;
})()
