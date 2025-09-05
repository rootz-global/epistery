/*
 * Witness
 *
 * This is the browser installed signer engaged by the user, pro-actively or
 * in the background, to engage with data-wallets through the epistery. It
 * provides a local signatory and other tools
 */
import {ethers, JsonRpcProvider} from '/.epistery/lib/ethers.js';

export default class Witness {
  constructor() {
    if (Witness.instance) return Witness.instance;
    Witness.instance = this;
    return this;
  }

  save() {
    localStorage.setItem('epistery', JSON.stringify(this));
  }

  load() {
    const data = localStorage.getItem('epistery');
    if (data) {
      const parsed = JSON.parse(data);
      Object.assign(this, parsed);
    }
  }

  static async connect() {
    let witness = new Witness();
    witness.load();
    try {
      let result = await fetch('/.epistery', {
        method: 'GET',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      })
      if (result.ok) {
        // If this.server is already defined, what to do if it is now presenting different data?
        witness.server = await result.json();
        if (witness.server.provider) {
          witness.rpc = new JsonRpcProvider(witness.server.provider.rpc);
          if (!witness.client) witness.initialize();
        }
      }
    } catch (e) {
      console.error(e);
    }
    return witness;
  }

  /**
   * Connect a client wallet for this domain. It should first check for plugin wallets that
   * can service the server's provider. The fallback to create a localStorage wallet
   */
  initialize() {
    let wallet = ethers.Wallet.createRandom(this.server.provider);
    this.client = {
      wallet: {
        address: wallet.address,
        mnemonic: wallet.mnemonic.phrase,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        signingKey: wallet.signingKey
      }
    };
    this.save();
  }

  async writeEvent(body) {
    // sign body with this.client.wallet. Include this.server.wallet for context
    let options = {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}};
    options.body = JSON.stringify(body);
    let result = await fetch('/.epistery/data/', options);
  }
}
