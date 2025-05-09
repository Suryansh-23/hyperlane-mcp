import { buildArtifact as coreBuildArtifact } from "@hyperlane-xyz/core/buildArtifact.js";
import { BaseRegistry, chainMetadata , GithubRegistry } from "@hyperlane-xyz/registry";
import {
    buildAgentConfig,
    ChainMap,
    ChainMetadata,
    ChainMetadataSchema,
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
import { ProtocolType } from "@hyperlane-xyz/utils";
import { ethers } from "ethers";
import { stringify as yamlStringify } from "yaml";
import { ChainConfig } from "./types.js";
import { addNativeTokenConfig } from "./config.js";

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