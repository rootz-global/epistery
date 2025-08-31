import {ethers, JsonRpcProvider} from "ethers";
import moment from 'moment';
import {existsSync, readFileSync, writeFileSync} from "fs";
import {resolve, basename, join} from "path";
import {compile} from "@parity/revive";
import DataWallet from "../index.mjs";

export default class ContractManager {
  constructor() {
    this.contractsFolder = resolve('./contracts');
  }

  static commandLine() {
    const contractManager = new ContractManager();
    return {
      compile: contractManager.compile.bind(contractManager),
      deploy: contractManager.compile.bind(contractManager),
      update: contractManager.compile.bind(contractManager)
    }
  }

  async compile(contractName, domain) {
    try {
      const dataWallet = await DataWallet.connect(domain);
      const filePath = resolve(`${this.contractsFolder}${contractName}.sol`);
      const source = readFileSync(filePath, 'utf8');
      this.log(`Compiling contract: ${basename(filePath)}...`);
      const out = await compile({
        [basename(filePath)]: {content: source},
      });

      for (const contracts of Object.values(out.contracts)) {
        for (const [name, contract] of Object.entries(contracts)) {
          this.log(`Compiled contract: ${name}`);
          dataWallet.config.writeFile(`${name}.json`, JSON.stringify(contract.abi, null, 2));
          this.log(`ABI saved to config folder: ${name}.json`);
          dataWallet.config.writeFile(`${name}.polkavm`, Buffer.from(contract.evm.bytecode.object, 'hex'));
          this.log(`Bytecode saved to config folder: ${name}.polkavm`);
        }
      }
    } catch (error) {
      console.error('Error compiling contracts:', error);
    }
  }

  async deploy(contractName, domain) {
    this.log(`Deploying ${contractName}...`);
    try {
      const dataWallet = await DataWallet.connect(domain);
      const abi = JSON.parse(dataWallet.config.readFile(contractName + '.json').toString());
      const byteCode = '0x' + dataWallet.config.readFile(contractName + '.polkavm').toString('hex');
      const factory = new ethers.ContractFactory(abi, byteCode, dataWallet.wallet);
      const contract = await factory.deploy();
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      console.log(`Contract ${contractName} deployed at: ${address}`);

      Object.assign(dataWallet.config.data, {contract: {address: address}});
      dataWallet.config.save();
    } catch (error) {
      console.error(`Failed to deploy contract ${contractName}:`, error);
    }
  };

  async update(contractName) {
    //TODO: this hasn't been updated like complie and deploy

    // try {
    //     const contract = this.getContract(contractName);
    //     let storedNumber = await contract.storedNumber();
    //     if (!storedNumber) storedNumber = 1;
    //     console.log(`Retrieved stored number:`, storedNumber.toString());
    //     const tx1 = await contract.setNumber(++storedNumber);
    //     await tx1.wait(); // Wait for the transaction to be mined
    //     console.log(`Number updated`);
    //     // Retrieve the updated number
    //     const updatedNumber = await contract.storedNumber();
    //     console.log(`Retrieved stored number:`, updatedNumber.toString());
    // } catch (error) {
    //     console.error('Error interacting with Storage contract:', error.message);
    // }
  }

  log(message) {
    console.log(`${moment().format('YY-MM-DD HH:mm:ss')}: ${message}`);
  }
}
