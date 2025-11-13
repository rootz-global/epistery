import Aquafier, { CredentialsData, Result, FileObject, AquaTreeWrapper, AquaOperationData, LogData, OkResult, AquaTree } from "aqua-js-sdk";
import { ClientWalletInfo } from "./types";

/**
  * Function for signing data with AQUA Protocol.
  * Creates an entire AQUA Tree with verifiable revisions.
  */
export const Aquafy = async (obj: string, clientWallet:ClientWalletInfo):Promise<AquaTree | undefined> => {
  try {
    console.log("Starting Aquafier process...");
    const aq = new Aquafier();

    const file:FileObject = {
      fileName: clientWallet?.address,
      fileContent: obj,
      path: ""
    }
    
    const genResult = await createGenesisRevisions(aq, file);
    if (!genResult)
      return undefined;

    if (genResult.isErr()) {
      console.error("Error encountered during genesis creation for test file");
      return undefined;
    }

    // Allows for linkage of multiple blobs of data together
    // Commented out for now since we're only signing individual strings
    /* const linkResult = await linkTrees(aq, genResult);
    if (!linkResult) return;

    if (linkResult.isErr()) {
      console.error("Error encountered during linking");
      return;
    } */

    if (!clientWallet.mnemonic) {
      throw new Error('Mnemonic is required for Aqua signing');
    }

    const creds: CredentialsData = {
      mnemonic: clientWallet.mnemonic,
      nostr_sk: "",
      did_key: "",
      alchemy_key: "", // Needed if using the Witness function
      witness_eth_network: "sepolia",
      witness_method: "cli"
    };

    const signResult = await signTree(aq, genResult.data.aquaTree!, file, creds);
    if (!signResult || signResult?.isErr()) {
      console.error("Error while processing witness result.");
      return undefined;
    }

    // Commenting out for now (demo purposes)
    // Needs a wallet to pay gas fees or use an Alchemy key
    /* const witnessResult = await witnessTree(aq, signResult, file, creds);
    if (witnessResult.isErr()) {
      console.error("Error while processing witness result.");
      return "";
    }
    const data:string = JSON.stringify(witnessResult?.data, null, 2); */

    const tree = signResult.data.aquaTree;
    console.log("Final Result:", tree);
    console.log("Aquafier process completed!");

    return tree!!;
  }
  catch (error) {
    console.error("Unexpected error in Aquafier process:", error);
  }
}

const createGenesisRevisions = async (aquafier: Aquafier, file:FileObject) => {
  console.log("Creating genesis revisions...");

  const genResult = await aquafier.createGenesisRevision(file);
  if (handleError(genResult, "Failed to create test file genesis"))
    return null;

  console.log("Genesis Result:", JSON.stringify(genResult.data, null, 2));

  return genResult;
};

const linkTrees = async (aquafier: Aquafier, genResults: OkResult<AquaOperationData, LogData[]>[], file: FileObject) => {
  console.log("Linking aqua trees...");
  if (genResults.length < 1) {
    console.error("Expected 2 or more objects to link.");
    return;
  }

  let linkResults: Result<AquaOperationData, LogData[]>[] = [];

  if (genResults.length === 2) {
    const wrapper = createWrapper(genResults[0].data.aquaTree!, file);
    const linkWrapper = createWrapper(genResults[1].data.aquaTree!, file);
    const linkResult = await aquafier.linkAquaTree(wrapper, linkWrapper);
    linkResults.push(linkResult);
    if (handleError(linkResult, "Failed to link aqua trees"))
      return null;

    return linkResult;
  }

  for (let i = 0; i < genResults.length; i++) {
    const res1 = genResults.pop();
    const res2 = genResults.pop();
    if (res1?.isErr() || res2?.isErr()) {
      console.error("Error while linking results. An object has an error.");
    }

    const wrapper = createWrapper(res1?.data.aquaTree!, file);
    const linkWrapper = createWrapper(res2?.data.aquaTree!, file);
    const linkResult = await aquafier.linkAquaTree(wrapper, linkWrapper);
    linkResults.push(linkResult);

    if (handleError(linkResult, "Failed to link aqua trees"))
      return null;
  }

  return linkResults;
};

const signTree = async (aquafier: Aquafier, tree:AquaTree, file:FileObject, creds:CredentialsData) => {
  console.log("Signing aqua tree...");

  const wrapper = createWrapper(tree, file);
  const signResult = await aquafier.signAquaTree(wrapper, "cli", creds);

  if (signResult.isErr()) {
    console.error("Error encountered during signing");
    return null;
  }

  return signResult;
};

/* const signTreeLink = async (aquafier: Aquafier, linkResult: OkResult<AquaOperationData, LogData[]>) => {
  console.log("Signing aqua tree...");

  const creds: CredentialsData = {
    mnemonic: "",
    nostr_sk: "",
    did_key: "",
    alchemy_key: "",
    witness_eth_network: "sepolia",
    witness_method: "metamask"
  };

  const wrapper = createWrapper(linkResult.data.aquaTree!, SAMPLE_FILES.testFile);
  const signResult = await aquafier.signAquaTree(wrapper, "cli", creds);

  if (signResult.isErr()) {
    console.error("Error encountered during signing");
    return null;
  }

  return signResult;
}; */

const witnessTree = async (aquafier: Aquafier, signResult: any, file:FileObject, creds:CredentialsData) => {
  console.log("Witnessing aqua tree...");

  const wrapper = createWrapper(signResult.data.aquaTree, file);
  const witnessResult = await aquafier.witnessAquaTree(
    wrapper,
    "eth",
    "sepolia",
    "cli",
    creds
  );

  if (handleError(witnessResult, "Failed to witness aqua tree")) {
    return witnessResult;
  }

  return witnessResult;
};

// Helper function to handle errors
const handleError = (result: any, errorMessage: string): boolean => {
  if (result.isErr()) {
    console.log(`${errorMessage}:`, JSON.stringify(result.data, null, 2));
    return true;
  }
  return false;
};

// Helper function to create AquaTreeWrapper
const createWrapper = (aquaTree: AquaTree, fileObject: FileObject): AquaTreeWrapper => ({
  aquaTree,
  fileObject,
  revision: ""
});
