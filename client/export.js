/*
 * Export - Wallet export utilities for Epistery
 *
 * Allows users with browser-based wallets to export their private keys
 * for import into Web3 wallets like MetaMask
 */

export default class Export {
  static getWalletExportData(witness) {
    if (!witness || !witness.wallet) {
      return {
        canExport: false,
        message: 'No wallet found to export.'
      };
    }

    const wallet = witness.wallet;

    // Only allow export for browser wallets (source === 'local')
    // Web3 wallets (MetaMask) should not export their keys
    if (wallet.source !== 'local') {
      return {
        canExport: false,
        source: wallet.source,
        message: 'This wallet is managed by a browser extension and cannot be exported from here.'
      };
    }

    return {
      canExport: true,
      source: wallet.source,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic,
      publicKey: wallet.publicKey
    };
  }

  static downloadAsJSON(data, filename = 'epistery-wallet-export.json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  static formatForMetaMask(exportData) {
    if (!exportData.canExport) {
      return null;
    }

    return {
      instructions: 'Import this private key into MetaMask or another Web3 wallet',
      privateKey: exportData.privateKey,
      address: exportData.address,
      warning: 'Keep this private key secure. Anyone with access to it can control your wallet.'
    };
  }
}