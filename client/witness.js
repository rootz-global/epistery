/*
 * Witness - Browser client for Epistery
 * 
 * This is the browser-side client that connects to the Epistery server
 * and provides local wallet functionality for signing data
 */

export default class Witness {
  constructor() {
    if (Witness.instance) return Witness.instance;
    Witness.instance = this;
    return this;
  }

  save() {
    localStorage.setItem('epistery', JSON.stringify({
      client: this.client,
      server: this.server
    }));
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
      let result = await fetch('/.epistery/api/status', {
        method: 'GET',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      });
      
      if (result.ok) {
        witness.server = await result.json();
        if (!witness.client) {
          await witness.initialize();
        }
      }
    } catch (e) {
      console.error('Failed to connect to Epistery server:', e);
    }
    
    return witness;
  }

  async initialize() {
    try {
      let result = await fetch('/.epistery/create', {
        method: 'GET',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
      });
      
      if (result.ok) {
        const response = await result.json();
        this.client = response.wallet; // Extract wallet from {wallet: ...} response
        this.save();
      }
    } catch (e) {
      console.error('Failed to initialize client wallet:', e);
    }
  }

  async writeEvent(data) {
    if (!this.client) {
      throw new Error('Client wallet not initialized');
    }

    try {
      let options = {
        method: 'POST', 
        credentials: 'include', 
        headers: {'Content-Type': 'application/json'}
      };
      options.body = JSON.stringify({
        clientWalletInfo: this.client,
        data: data
      });
      
      let result = await fetch('/.epistery/data/write', options);
      
      if (result.ok) {
        return await result.json();
      } else {
        throw new Error(`Write failed with status: ${result.status}`);
      }
    } catch (e) {
      console.error('Failed to write event:', e);
      throw e;
    }
  }

  getStatus() {
    return {
      client: this.client,
      server: this.server,
      connected: !!(this.client && this.server)
    };
  }
}