import { BigNumberish, ethers, Wallet } from 'ethers';
import { Config } from './Config';
import { DomainConfig } from './types';
import * as AgentArtifact from '../../artifacts/contracts/agent.sol/Agent.json';

export class Utils {
  private static config: Config;
  private static serverWallet: ethers.Wallet| null = null;

  // Gas estimation constants
  private static readonly FALLBACK_GAS_LIMIT = 200000;
  private static readonly FALLBACK_GENESIS_GAS_LIMIT = 30000;
  private static readonly FALLBACK_SIMPLE_TRANSFER_GAS = 21000;
  private static readonly GAS_PRICE_BUFFER_PERCENT = 20;
  private static readonly GAS_LIMIT_BUFFER_PERCENT = 30;
  private static readonly FUNDING_SAFETY_BUFFER_PERCENT = 5;

  // Chain IDs
  private static readonly POLYGON_MAINNET_CHAIN_ID = 137;
  private static readonly POLYGON_AMOY_CHAIN_ID = 80002;

  /**
   * Helper: Get gas price with buffer (works for any EVM chain: Ethereum, Polygon, etc.)
   * @param wallet - Wallet to get gas price from
   * @param bufferPercent - Buffer percentage (default 20%)
   * @returns Gas price with buffer
   */
  private static async getGasPriceWithBuffer(wallet: Wallet, bufferPercent: number = Utils.GAS_PRICE_BUFFER_PERCENT): Promise<ethers.BigNumber> {
    const baseGasPrice = await wallet.getGasPrice();
    return baseGasPrice.mul(100 + bufferPercent).div(100);
  }

  /**
   * Helper: Add buffer to gas limit
   * @param gasLimit - Estimated gas limit
   * @param bufferPercent - Buffer percentage (default 30%)
   * @returns Gas limit with buffer
   */
  private static addGasBuffer(gasLimit: ethers.BigNumber, bufferPercent: number = Utils.GAS_LIMIT_BUFFER_PERCENT): ethers.BigNumber {
    return gasLimit.mul(100 + bufferPercent).div(100);
  }

  /**
   * Helper: Calculate total transaction cost (gas + value)
   * Works for any EVM chain (ETH, MATIC, etc.)
   */
  private static calculateTotalCost(gasLimit: ethers.BigNumber, gasPrice: ethers.BigNumber, value: BigNumberish = 0): ethers.BigNumber {
    const totalGas = gasPrice.mul(gasLimit);
    return totalGas.add(value);
  }

  public static InitServerWallet(domain: string = 'localhost'): ethers.Wallet | null {
    try {
      if (!this.config) {
        this.config = new Config();
      }

      // Load domain config
      this.config.setPath(domain);

      const domainConfig = this.config.data.domain ? this.config.data : {domain: domain};

      // Get default provider if not set
      if (!domainConfig.provider) {
        this.config.setPath('/');
        domainConfig.provider = this.config.data.default?.provider;
        this.config.setPath(domain); // Switch back to domain
      }

      if (!domainConfig.wallet) {
        console.log(`No wallet found for domain: ${domain}, creating new wallet...`);

        const wallet = ethers.Wallet.createRandom();

        domainConfig.wallet = {
          address: wallet.address,
          mnemonic: wallet.mnemonic?.phrase || '',
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
        };

        this.config.data = domainConfig;
        this.config.save();

        console.log(`[debug] Created new wallet for domain: ${domain}`);
        console.log(`[debug] Wallet address: ${wallet.address}`);
      }

      if (domainConfig.wallet) {
        const provider = new ethers.providers.JsonRpcProvider(domainConfig.provider?.rpc);
        this.serverWallet = ethers.Wallet.fromMnemonic(domainConfig.wallet.mnemonic).connect(provider);

        console.log(`Server wallet initialized for domain: ${domain}`);
        console.log(`Wallet address: ${domainConfig.wallet.address}`);
        console.log(`Provider: ${domainConfig.provider?.name}`);

        return this.serverWallet;
      }

      return null;
    } catch (error) {
      console.error('Error initializing server wallet:', error);
      return null;
    }
  }

  public static GetServerWallet(): ethers.Wallet | null {
    return this.serverWallet;
  }

  public static GetConfig(): Config {
    if (!this.config) {
      this.config = new Config();
    }
    return this.config;
  }

  public static GetDomainInfo(domain: string = 'localhost'): DomainConfig {
    if (!this.config) {
      this.config = new Config();
    }

    this.config.setPath(`/${domain}`);
    this.config.load();

    if (!this.config.data.domain)
      return {domain:domain};

    return this.config.data;
  }

  public static async ReadFromContract(clientWallet: Wallet): Promise<any> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        clientWallet
      );

      const ipfsHashes = await agentContract.read();

      if (!ipfsHashes || ipfsHashes.length === 0) {
        console.log('No data found for this address');
        return null;
      }

      console.log(`Data read from Agent contract. Found ${ipfsHashes.length} message(s)`);

      // Fetch the data from IPFS for all hashes
      const config = Utils.GetConfig();
      const ipfsGatewayUrl = config.data.ipfs?.gateway || 'http://localhost:8080';

      const allMessages = [];
      for (let i = 0; i < ipfsHashes.length; i++) {
        const ipfsHash = ipfsHashes[i];
        const ipfsUrl = `${ipfsGatewayUrl}/ipfs/${ipfsHash}`;

        try {
          const response = await fetch(ipfsUrl);
          if (!response.ok) {
            console.warn(`Failed to fetch data from IPFS for hash ${ipfsHash}: ${response.status}`);
            allMessages.push({
              index: i,
              ipfsHash: ipfsHash,
              ipfsUrl: ipfsUrl,
              data: null,
              error: `Failed to fetch: ${response.status}`
            });
            continue;
          }

          const ipfsData = await response.json();
          allMessages.push({
            index: i,
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            data: ipfsData,
            error: null
          });
        }
        catch (error) {
          console.warn(`Error fetching IPFS data for hash ${ipfsHash}:`, error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          allMessages.push({
            index: i,
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            data: null,
            error: errorMessage
          });
        }
      }

      return {
        count: ipfsHashes.length,
        messages: allMessages
      };
    }
    catch (error) {
      console.error('Error reading from Agent contract:', error);
      throw new Error(`Failed to read from Agent contract: ${error}`);
    }
  }

  public static async WriteToContract(clientWallet: Wallet, hash: string | undefined): Promise<any> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        clientWallet
      );

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(clientWallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.write(clientWallet.publicKey, hash);
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Contract write - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract write failed, using default limit');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GAS_LIMIT);
      }

      // Call the write function with publicKey and data
      const tx = await agentContract.write(clientWallet.publicKey, hash, {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Data written to Agent contract. Tx: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    }
    catch (error) {
      console.error('Error writing to Agent contract:', error);
      throw new Error(`Failed to write to Agent contract: ${error}`);
    }
  }

  public static async TransferOwnership(clientWallet: Wallet, futureOwnerWalletAddress: string) {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        clientWallet
      );

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(clientWallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.transferOwnership(futureOwnerWalletAddress);
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Contract transferOwnership - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract transferOwnership failed, using default limit');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GAS_LIMIT);
      }

      // Call the transferOwnership function with pubKey of future owner
      const tx = await agentContract.transferOwnership(futureOwnerWalletAddress, {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Data written to Agent contract. Tx: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    }
    catch (error) {
      console.error('Error transferring ownership:', error);
      throw new Error(`Failed to transfer ownership: ${error}`);
    }
  }

  /**
   * Fund a wallet with native currency (ETH, MATIC, etc.)
   * Works with any EVM chain (Ethereum, Polygon, Arbitrum, etc.)
   * @param from - Source wallet (pays gas + amount)
   * @param to - Destination wallet (receives amount)
   * @param amount - Amount to send in wei
   * @param estimatedGasForNextOp - Optional: estimated gas for recipient's next operation
   * @returns Transaction hash or null
   */
  public static async FundWallet(
    from: Wallet,
    to: Wallet,
    amount: BigNumberish,
    estimatedGasForNextOp?: ethers.BigNumber
  ): Promise<string | null> {
    try {
      if (!from || !to)
        return null;

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(from, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for THIS funding transaction
      const estimatedGas = await from.estimateGas({
        to: to.address,
        value: amount
      });
      const gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);

      // If we know the recipient needs to do another operation, add that gas cost to the amount
      let finalAmount = ethers.BigNumber.from(amount);
      if (estimatedGasForNextOp) {
        const additionalGasCost = gasPrice.mul(estimatedGasForNextOp);
        finalAmount = finalAmount.add(additionalGasCost);
        console.log(`Adding gas for recipient's next operation: ${ethers.utils.formatEther(additionalGasCost)} (native currency)`);
      }

      const provider = from.provider;
      const chainId = provider ? await provider.getNetwork().then(n => n.chainId) : 'unknown';
      const currencySymbol = chainId === Utils.POLYGON_MAINNET_CHAIN_ID || chainId === Utils.POLYGON_AMOY_CHAIN_ID ? 'MATIC' : 'ETH';

      console.log(`Funding wallet with:`);
      console.log(`  Chain ID: ${chainId} (${currencySymbol})`);
      console.log(`  Amount: ${ethers.utils.formatEther(finalAmount)} ${currencySymbol}`);
      console.log(`  Estimated Gas: ${estimatedGas.toString()}`);
      console.log(`  Gas Limit (with buffer): ${gasLimit.toString()}`);
      console.log(`  Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);

      const fundingTxn = await from.sendTransaction({
        to: to.address,
        value: finalAmount,
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Funding txn sent \nfrom:${from.address}\nto:${to.address}`);
      const result = await fundingTxn.wait();
      if (!result)
        return null;

      console.log(`Funding Txn Result: ${result.transactionHash}`)
      return result.transactionHash;
    }
    catch (error) {
      throw new Error(`Error while funding wallet: ${error}`);
    }
  }

  public static async CompleteGenesis(wallet: Wallet): Promise<string | null> {
    try {
      const genesisData = {
        owner: wallet.address,
        createdAt: Date.now(),
        type: 'genesis'
      };

      const data = ethers.utils.toUtf8Bytes(JSON.stringify(genesisData));

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(wallet, 20);

      // Estimate gas for the transaction
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await wallet.estimateGas({
          to: wallet.address,
          value: ethers.utils.parseEther('0.000'),
          data: data
        });
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Genesis - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      } catch (error) {
        console.warn('Gas estimation for genesis failed, using default');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GENESIS_GAS_LIMIT);
      }

      const genesisTxn = await wallet.sendTransaction({
        to: wallet.address,
        value: ethers.utils.parseEther('0.000'),
        data: data,
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      const result = await genesisTxn.wait();
      if (!result)
        return null;

      console.log(`Genesis Txn Result: ${result.transactionHash}`)
      return result.transactionHash;
    }
    catch (error) {
      throw new Error(`Failed to complete genesis: ${error}`);
    }
  }

  /**
   * Ensure a wallet has enough funds for an operation, funding it if necessary
   * This is the recommended way to prepare wallets for contract operations
   * @param serverWallet - Wallet to fund from (typically server wallet)
   * @param clientWallet - Wallet to check/fund (typically client wallet)
   * @param operationGasEstimate - Estimated gas for the operation the client will perform
   * @param value - Optional value the client needs to send (default 0)
   * @returns True if wallet has or was given enough funds
   */
  public static async EnsureFunded(
    serverWallet: Wallet,
    clientWallet: Wallet,
    operationGasEstimate: ethers.BigNumber,
    value: BigNumberish = 0
  ): Promise<boolean> {
    try {
      // Check if client has enough funds
      const hasEnough = await this.HasEnoughFunds(clientWallet, ethers.BigNumber.from(value), operationGasEstimate);

      if (hasEnough) {
        console.log(`Client wallet ${clientWallet.address} has sufficient funds`);
        return true;
      }

      console.log(`Client wallet ${clientWallet.address} needs funding...`);

      // Calculate how much to fund
      const gasPrice = await this.getGasPriceWithBuffer(clientWallet, Utils.GAS_PRICE_BUFFER_PERCENT);
      const gasLimit = this.addGasBuffer(operationGasEstimate, Utils.GAS_LIMIT_BUFFER_PERCENT);
      const totalNeeded = this.calculateTotalCost(gasLimit, gasPrice, value);

      // Add a small buffer for safety
      const fundingAmount = totalNeeded.mul(100 + Utils.FUNDING_SAFETY_BUFFER_PERCENT).div(100);

      console.log(`Funding client with ${ethers.utils.formatEther(fundingAmount)} (native currency)`);

      // Fund the wallet
      const txHash = await this.FundWallet(serverWallet, clientWallet, fundingAmount);

      if (!txHash) {
        console.error('Funding failed');
        return false;
      }

      console.log(`Client wallet funded successfully`);
      return true;
    }
    catch (error) {
      console.error('Error ensuring wallet is funded:', error);
      return false;
    }
  }

  /**
   * Check if wallet has enough funds for a transaction (works with any EVM chain)
   * @param wallet - Wallet to check
   * @param minimumAmountToSend - Amount needed for the transaction
   * @param estimatedGasLimit - Optional: pre-estimated gas limit for the operation
   * @returns True if wallet has enough funds
   */
  public static async HasEnoughFunds(
    wallet: Wallet,
    minimumAmountToSend: ethers.BigNumber,
    estimatedGasLimit?: ethers.BigNumber
  ): Promise<boolean> {
    if (!wallet)
      return false;

    try {
      const balance = await wallet.getBalance();

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(wallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas if not provided
      let gasLimit: ethers.BigNumber;
      if (estimatedGasLimit) {
        gasLimit = this.addGasBuffer(estimatedGasLimit, Utils.GAS_LIMIT_BUFFER_PERCENT);
      } else {
        let estimatedGas: ethers.BigNumber;
        try {
          estimatedGas = await wallet.estimateGas({
            to: wallet.address,
            value: minimumAmountToSend
          });
        } catch (error) {
          console.warn('Gas estimation failed, using default 21000');
          estimatedGas = ethers.BigNumber.from(Utils.FALLBACK_SIMPLE_TRANSFER_GAS);
        }
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
      }

      const totalCost = this.calculateTotalCost(gasLimit, gasPrice, minimumAmountToSend);

      const provider = wallet.provider;
      const chainId = provider ? await provider.getNetwork().then(n => n.chainId) : 'unknown';
      const currencySymbol = chainId === Utils.POLYGON_MAINNET_CHAIN_ID || chainId === Utils.POLYGON_AMOY_CHAIN_ID ? 'MATIC' : 'ETH';

      console.log(`Checking funds for ${wallet.address}:`);
      console.log(`  Chain ID: ${chainId} (${currencySymbol})`);
      console.log(`  Balance: ${ethers.utils.formatEther(balance)} ${currencySymbol}`);
      console.log(`  Amount to send: ${ethers.utils.formatEther(minimumAmountToSend)} ${currencySymbol}`);
      console.log(`  Gas Limit (with buffer): ${gasLimit.toString()}`);
      console.log(`  Gas Price (with buffer): ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);
      console.log(`  Total Cost: ${ethers.utils.formatEther(totalCost)} ${currencySymbol}`);

      if (balance.lt(totalCost)) {
        console.log(`  Insufficient funds (short by ${ethers.utils.formatEther(totalCost.sub(balance))} ${currencySymbol})`);
        return false;
      }

      console.log(`  Sufficient funds`);
      return true;
    }
    catch (error) {
      console.error('Error checking funds:', error);
      return false;
    }
  }

  public static async AddToWhitelist(ownerWallet: Wallet, addressToAdd: string, domain: string): Promise<any> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        ownerWallet
      );

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(ownerWallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.addToWhitelist(addressToAdd, domain);
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Contract addToWhitelist - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract addToWhitelist failed, using default limit');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GAS_LIMIT);
      }

      const tx = await agentContract.addToWhitelist(addressToAdd, domain, {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Added ${addressToAdd} to whitelist for domain ${domain}. Tx: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    }
    catch (error) {
      console.error('Error adding to whitelist:', error);
      throw new Error(`Failed to add to whitelist: ${error}`);
    }
  }

  public static async RemoveFromWhitelist(ownerWallet: Wallet, addressToRemove: string, domain: string): Promise<any> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        ownerWallet
      );

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(ownerWallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.removeFromWhitelist(addressToRemove, domain);
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Contract removeFromWhitelist - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract removeFromWhitelist failed, using default limit');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GAS_LIMIT);
      }

      // Call the removeFromWhitelist function
      const tx = await agentContract.removeFromWhitelist(addressToRemove, domain, {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Removed ${addressToRemove} from whitelist for domain ${domain}. Tx: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    }
    catch (error) {
      console.error('Error removing from whitelist:', error);
      throw new Error(`Failed to remove from whitelist: ${error}`);
    }
  }

  public static async GetWhitelist(wallet: Wallet, ownerAddress: string, domain: string): Promise<string[]> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        wallet
      );

      const whitelist = await agentContract.getWhitelist(ownerAddress, domain);

      console.log(`Whitelist for ${ownerAddress} on domain ${domain}: ${whitelist.length} address(es)`);

      return whitelist;
    }
    catch (error) {
      console.error('Error getting whitelist:', error);
      throw new Error(`Failed to get whitelist: ${error}`);
    }
  }

  public static async IsWhitelisted(wallet: Wallet, ownerAddress: string, domain: string, addressToCheck: string): Promise<boolean> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        wallet
      );

      const isWhitelisted = await agentContract.isWhitelisted(ownerAddress, domain, addressToCheck);

      return isWhitelisted;
    }
    catch (error) {
      console.error('Error checking whitelist status:', error);
      throw new Error(`Failed to check whitelist status: ${error}`);
    }
  }

  public static async CreateApproval(requestorWallet: Wallet, approverAddress: string, fileName: string, fileHash: string, domain: string): Promise<any> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        requestorWallet
      );

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(requestorWallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.createApproval(approverAddress, fileName, fileHash, domain);
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Contract createApproval - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract createApproval failed, using default limit');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GAS_LIMIT);
      }

      const tx = await agentContract.createApproval(approverAddress, fileName, fileHash, domain, {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Created request from ${requestorWallet.address} to ${approverAddress} for file ${fileName}. Tx: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    }
    catch (error) {
      console.error('Error creating approval:', error);
      throw new Error(`Failed to create approval: ${error}`);
    }
  }

  public static async GetApprovalsByAddress(wallet: Wallet, approverAddress: string, requestorAddress: string): Promise<any[]> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        wallet
      );

      const approvals = await agentContract.getApprovalsByAddress(approverAddress, requestorAddress);

      console.log(`Found ${approvals.length} request(s) for approver ${approverAddress} from requestor ${requestorAddress}`);

      // Convert ethers.js Result objects to plain JavaScript objects
      const plainApprovals = approvals.map((approval: any) => ({
        approved: approval.approved,
        fileName: approval.fileName,
        fileHash: approval.fileHash,
        processedAt: approval.processedAt.toNumber(),
        exists: approval.exists
      }));

      return plainApprovals;
    }
    catch (error) {
      console.error('Error getting approvals:', error);
      throw new Error(`Failed to get approvals: ${error}`);
    }
  }

  public static async GetAllApprovalsForApprover(wallet: Wallet, approverAddress: string): Promise<any[]> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        wallet
      );

      const approvals = await agentContract.getAllApprovalsForApprover(approverAddress);

      console.log(`Found ${approvals.length} total request(s) for approver ${approverAddress}`);

      // Convert ethers.js Result objects to plain JavaScript objects
      const plainApprovals = approvals.map((approval: any) => ({
        requestor: approval.requestor,
        approved: approval.approved,
        fileName: approval.fileName,
        fileHash: approval.fileHash,
        processedAt: approval.processedAt.toNumber(),
        exists: approval.exists
      }));

      return plainApprovals;
    }
    catch (error) {
      console.error('Error getting all approvals:', error);
      throw new Error(`Failed to get all approvals: ${error}`);
    }
  }

  public static async GetAllApprovalsForRequestor(wallet: Wallet, requestorAddress: string): Promise<any[]> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        wallet
      );

      const approvals = await agentContract.getAllApprovalsForRequestor(requestorAddress);

      console.log(`Found ${approvals.length} total request(s) for requestor ${requestorAddress}`);

      // Convert ethers.js Result objects to plain JavaScript objects
      // Note: The 'requestor' field actually contains the approver address for this function
      const plainApprovals = approvals.map((approval: any) => ({
        approver: approval.requestor, // This is actually the approver address
        approved: approval.approved,
        fileName: approval.fileName,
        fileHash: approval.fileHash,
        processedAt: approval.processedAt.toNumber(),
        exists: approval.exists
      }));

      return plainApprovals;
    }
    catch (error) {
      console.error('Error getting all approvals for requestor:', error);
      throw new Error(`Failed to get all approvals for requestor: ${error}`);
    }
  }

  public static async HandleApproval(approverWallet: Wallet, requestorAddress: string, fileName: string, approved: boolean): Promise<any> {
    try {
      const agentContractAddress = process.env.AGENT_CONTRACT_ADDRESS;
      if (!agentContractAddress || agentContractAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Agent contract address not configured');
      }

      const agentContract = new ethers.Contract(
        agentContractAddress,
        AgentArtifact.abi,
        approverWallet
      );

      // Use helper functions
      const gasPrice = await this.getGasPriceWithBuffer(approverWallet, Utils.GAS_PRICE_BUFFER_PERCENT);

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.handleApproval(requestorAddress, fileName, approved);
        gasLimit = this.addGasBuffer(estimatedGas, Utils.GAS_LIMIT_BUFFER_PERCENT);
        console.log(`Contract handleApproval - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract handleApproval failed, using default limit');
        gasLimit = ethers.BigNumber.from(Utils.FALLBACK_GAS_LIMIT);
      }

      const tx = await agentContract.handleApproval(requestorAddress, fileName, approved, {
        gasLimit: gasLimit,
        gasPrice: gasPrice
      });

      console.log(`Approval ${approved ? 'approved' : 'denied'} by ${approverWallet.address} for request from ${requestorAddress} (file: ${fileName}). Tx: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      return receipt;
    }
    catch (error) {
      console.error('Error handling approval:', error);
      throw new Error(`Failed to handle approval: ${error}`);
    }
  }
}
