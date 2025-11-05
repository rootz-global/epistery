import { BigNumberish, ethers, Wallet } from 'ethers';
import { Config } from './Config';
import { DomainConfig } from './types';
import * as AgentArtifact from '../../artifacts/contracts/agent.sol/Agent.json';

export class Utils {
  private static config: Config;
  private static serverWallet: ethers.Wallet| null = null;

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

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.write(clientWallet.publicKey, hash);
        
        // Add 30% buffer to avoid UNPREDICTABLE_GAS_LIMIT errors
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Contract write - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract write failed, using default limit');
        gasLimit = ethers.BigNumber.from(100000); // Fallback gas limit
      }

      // Get gas price with buffer
      const baseGasPrice = await clientWallet.getGasPrice();
      const gasPrice = baseGasPrice.mul(120).div(100); // +20% buffer

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

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.transferOwnership(futureOwnerWalletAddress);
        
        // Add 30% buffer to avoid UNPREDICTABLE_GAS_LIMIT errors
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Contract transferOwnership - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract transferOwnership failed, using default limit');
        gasLimit = ethers.BigNumber.from(100000); // Fallback gas limit
      }

      // Get gas price with buffer
      const baseGasPrice = await clientWallet.getGasPrice();
      const gasPrice = baseGasPrice.mul(120).div(100); // +20% buffer

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

  public static async FundWallet(from: Wallet, to: Wallet, amount: BigNumberish): Promise<string | null> {
    try {
      if (!from || !to)
        return null;

      // Get current gas price and add 20% buffer for price fluctuations
      const baseGasPrice: ethers.BigNumber = await from.getGasPrice();
      const gasPrice: ethers.BigNumber = baseGasPrice.mul(120).div(100); // +20% buffer

      // Estimate gas for the transaction
      const estimatedGas: ethers.BigNumber = await from.estimateGas({
        to: to.address,
        value: amount
      });

      // Add 30% buffer to gas limit to avoid UNPREDICTABLE_GAS_LIMIT errors
      const gasLimit: ethers.BigNumber = estimatedGas.mul(130).div(100); // +30% buffer

      console.log(`Funding wallet with:`);
      console.log(`  Amount: ${ethers.utils.formatEther(amount)} ETH`);
      console.log(`  Estimated Gas: ${estimatedGas.toString()}`);
      console.log(`  Gas Limit (with buffer): ${gasLimit.toString()}`);
      console.log(`  Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);

      const fundingTxn: ethers.providers.TransactionResponse = await from.sendTransaction({
        to: to.address,
        value: amount,
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

      // Get gas price with buffer
      const baseGasPrice: ethers.BigNumber = await wallet.getGasPrice();
      const gasPrice: ethers.BigNumber = baseGasPrice.mul(120).div(100); // +20% buffer

      // Estimate gas for the transaction
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await wallet.estimateGas({
          to: wallet.address,
          value: ethers.utils.parseEther('0.000'),
          data: data
        });
        // Add 30% buffer
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Genesis - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      } catch (error) {
        console.warn('Gas estimation for genesis failed, using default');
        gasLimit = ethers.BigNumber.from(30000); // Fallback
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

  public static async HasEnoughFunds(wallet: Wallet, minimumAmountToSend: ethers.BigNumber): Promise<boolean> {
    if (!wallet)
      return false;

    try {
      const balance: ethers.BigNumber = await wallet.getBalance();

      // Get gas price with 20% buffer for fluctuations
      const baseGasPrice: ethers.BigNumber = await wallet.getGasPrice();
      const gasPrice: ethers.BigNumber = baseGasPrice.mul(120).div(100);

      // Estimate gas for a typical transaction (self-transfer)
      let estimatedGas: ethers.BigNumber;
      try {
        estimatedGas = await wallet.estimateGas({
          to: wallet.address,
          value: minimumAmountToSend
        });
      } catch (error) {
        // Fallback to standard 21000 gas for simple transfers if estimation fails
        console.warn('Gas estimation failed, using default 21000');
        estimatedGas = ethers.BigNumber.from(21000);
      }

      // Add 30% buffer to gas estimate
      const gasLimit: ethers.BigNumber = estimatedGas.mul(130).div(100);
      const totalGasCost: ethers.BigNumber = gasPrice.mul(gasLimit);

      console.log(`Checking funds for ${wallet.address}:`);
      console.log(`  Balance: ${ethers.utils.formatEther(balance)} ETH`);
      console.log(`  Amount to send: ${ethers.utils.formatEther(minimumAmountToSend)} ETH`);
      console.log(`  Estimated Gas: ${estimatedGas.toString()}`);
      console.log(`  Gas Limit (with buffer): ${gasLimit.toString()}`);
      console.log(`  Gas Price (with buffer): ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);
      console.log(`  Total Gas Cost: ${ethers.utils.formatEther(totalGasCost)} ETH`);

      const totalNeeded: ethers.BigNumber = totalGasCost.add(minimumAmountToSend);
      console.log(`  Total Needed: ${ethers.utils.formatEther(totalNeeded)} ETH`);

      if (balance.lt(totalNeeded)) {
        console.log(`  Insufficient funds (short by ${ethers.utils.formatEther(totalNeeded.sub(balance))} ETH)`);
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

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.addToWhitelist(addressToAdd, domain);

        // Add 30% buffer to avoid UNPREDICTABLE_GAS_LIMIT errors
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Contract addToWhitelist - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract addToWhitelist failed, using default limit');
        gasLimit = ethers.BigNumber.from(100000); // Fallback gas limit
      }

      // Get gas price with buffer
      const baseGasPrice = await ownerWallet.getGasPrice();
      const gasPrice = baseGasPrice.mul(120).div(100); // +20% buffer

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

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.removeFromWhitelist(addressToRemove, domain);

        // Add 30% buffer to avoid UNPREDICTABLE_GAS_LIMIT errors
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Contract removeFromWhitelist - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract removeFromWhitelist failed, using default limit');
        gasLimit = ethers.BigNumber.from(100000); // Fallback gas limit
      }

      // Get gas price with buffer
      const baseGasPrice = await ownerWallet.getGasPrice();
      const gasPrice = baseGasPrice.mul(120).div(100); // +20% buffer

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

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.createApproval(approverAddress, fileName, fileHash, domain);

        // Add 30% buffer to avoid UNPREDICTABLE_GAS_LIMIT errors
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Contract createApproval - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract createApproval failed, using default limit');
        gasLimit = ethers.BigNumber.from(200000); // Fallback gas limit
      }

      // Get gas price with buffer
      const baseGasPrice = await requestorWallet.getGasPrice();
      const gasPrice = baseGasPrice.mul(120).div(100); // +20% buffer

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

      // Estimate gas for the contract write
      let gasLimit: ethers.BigNumber;
      try {
        const estimatedGas = await agentContract.estimateGas.handleApproval(requestorAddress, fileName, approved);

        // Add 30% buffer to avoid UNPREDICTABLE_GAS_LIMIT errors
        gasLimit = estimatedGas.mul(130).div(100);
        console.log(`Contract handleApproval - Estimated Gas: ${estimatedGas.toString()}, With Buffer: ${gasLimit.toString()}`);
      }
      catch (error) {
        console.warn('Gas estimation for contract handleApproval failed, using default limit');
        gasLimit = ethers.BigNumber.from(150000); // Fallback gas limit
      }

      // Get gas price with buffer
      const baseGasPrice = await approverWallet.getGasPrice();
      const gasPrice = baseGasPrice.mul(120).div(100); // +20% buffer

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
