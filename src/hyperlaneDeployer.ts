import { buildArtifact as coreBuildArtifact } from "@hyperlane-xyz/core/buildArtifact.js";
import { BaseRegistry, chainMetadata , GithubRegistry } from "@hyperlane-xyz/registry";
import {
    buildAgentConfig,
    ChainMap,
    ChainMetadata,
    ChainMetadataSchema,
    ChainName,
    ContractVerifier,
    CoreConfigSchema,
    EvmCoreModule,
    ExplorerLicenseType,
    HyperlaneCore,
    HyperlaneDeploymentArtifacts,
    IsmType,
    MultiProvider,
    OwnableConfig,
} from "@hyperlane-xyz/sdk";
import   { Address } from "@hyperlane-xyz/utils";
import { ProtocolType } from "@hyperlane-xyz/utils";
import { ethers, BigNumber } from "ethers";
import { stringify as yamlStringify } from "yaml";

import { ChainConfig } from "./types.js";
import { addNativeTokenConfig  , createMerkleTreeConfig , createMultisignConfig} from "./config.js";
import { privateKeyToSigner } from "./utils.js";

export async function prepareDeploy(
    userAddress : Address | null , 
    chains : ChainName[] , 
    multiProvider : MultiProvider
): Promise< Record<string , BigNumber>  >  {
   
    const initialBalances : Record<string , BigNumber> = {}
    await Promise.all(
        chains.map(async (chain: ChainName) => {
            const provider = multiProvider.getProvider(chain);
            const address =
                userAddress ??
                (await multiProvider.getSigner(chain).getAddress());
            const currentBalance = await provider.getBalance(address);
            initialBalances[chain] = currentBalance;
        })
    );

    return initialBalances ; 
}


export async function createChainConfig({
    config  , 
    wantNativeTokenConfig , 
    registry
} :  { 
    config : ChainConfig, 
    wantNativeTokenConfig : boolean, 
    registry : BaseRegistry
}) {
    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl); 
    const metadata : ChainMetadata = {
        name : config.chainName , 
        displayName : config.chainName, 
        chainId : config.chainId , 
        domainId: Number(config.chainId) , 
        protocol : ProtocolType.Ethereum , 
        rpcUrls : [{
            http : config.rpcUrl 
        }],

        isTestnet : config.isTestnet 

    }
    await addNativeTokenConfig(metadata , { tokenSymbol : config.tokenSymbol , tokenName : config.tokenName } , wantNativeTokenConfig); // adds the token config as well

    const parseResult = ChainMetadataSchema.safeParse(metadata);

    if (parseResult.success) {
        const metadataYaml = yamlStringify(metadata, {
            indent: 2,
            sortMapEntries: true,
        });

        await registry.addChain({ chainName: metadata.name, metadata });

        console.log("Chain metadata created" , metadataYaml);
    } else {
        console.log(parseResult.error);
        console.error("Error in creating chain metadata");
        throw new Error("Error in creating chain metadata" ,);
    }

}

export async function InitializeDeployment () { 
    const defaultIsm = await createMultisignConfig(IsmType.MERKLE_ROOT_MULTISIG);
    const defaultHook = await createMerkleTreeConfig();
    const requiredHook = await createMerkleTreeConfig();

    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY environment variable is required");
    }
    const owner = await privateKeyToSigner(process.env.PRIVATE_KEY);

    const proxyAdmin : OwnableConfig = { 
        owner : owner.address
    }

    try { 
        const coreConfig = CoreConfigSchema.parse({
            owner,
            defaultIsm,
            defaultHook,
            requiredHook,
            proxyAdmin,
        });

        return coreConfig ; 

    }catch(e) { 
        console.log(e);
        throw new Error("Error in creating core config");
    }

}

export async function runCoreDeploy ( config : ChainConfig ) { 
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY environment variable is required");
    }
    const signer = await privateKeyToSigner(process.env.PRIVATE_KEY);
    const metadata : ChainMetadata = {
        name : config.chainName , 
        displayName : config.chainName, 
        chainId : config.chainId , 
        domainId: Number(config.chainId) , 
        protocol : ProtocolType.Ethereum , 
        rpcUrls : [{
            http : config.rpcUrl 
        }],

        isTestnet : config.isTestnet 

    }
    const multiProvider = new MultiProvider({
        [config.chainName]: metadata
    })

    const userAddress = signer.address ; 
    const chain = config.chainName

    const initialBalances = await prepareDeploy( userAddress , [chain] , multiProvider  )


    //TODO : implementation of furter steps
}


