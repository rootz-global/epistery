/*
 * Epistery Client Library
 * 
 * Main client library that can be included via script tag
 * Provides easy access to Epistery functionality
 */

import Witness from './witness.js';

// Make Witness available globally when loaded as a script
if (typeof window !== 'undefined') {
  window.Witness = Witness;
  window.Epistery = {
    Witness: Witness,
    connect: async () => await Witness.connect()
  };
}

export { Witness };
export default Witness;