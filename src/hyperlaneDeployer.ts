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
import { writeYamlOrJson } from "./configOpts.js";

import { ChainConfig } from "./types.js";
import { addNativeTokenConfig  , createMerkleTreeConfig , createMultisignConfig} from "./config.js";
import { confirmExistingMailbox, privateKeyToSigner , requestAndSaveApiKeys, transformChainMetadataForDisplay , assertSigner , nativeBalancesAreSufficient, filterAddresses, getStartBlocks, handleMissingInterchainGasPaymaster, validateAgentConfig } from "./utils.js";
import { MINIMUM_CORE_DEPLOY_GAS } from "./consts.js";

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


export async function runDeployPlanStep(
    chainMetadata : ChainMap<ChainMetadata> , 
    chain : ChainName , 
    multiProvider : MultiProvider
) { 

    
    const address = multiProvider.getSigner(chain).getAddress() ; 
    const transformChainMetadata = transformChainMetadataForDisplay(
        chainMetadata[chain]
    )

    console.log("\nDeployment plan");
    console.log("===============");
    console.log(
        `Transaction signer and owner of new contracts: ${address}`
    );
    console.log(`Deploying core contracts to network: ${chain}`);


    confirmExistingMailbox( chain )


}


export async function runPreflightChecksForChains(
    multiProvider : MultiProvider , 
    chains :  ChainName[] , 
    minGas : string , 
    chainsToGasCheck? : ChainName[]
) { 
    if (!chains?.length) throw new Error("Empty chain selection");

    for (const chain of chains) {
        const metadata = multiProvider.tryGetChainMetadata(chain);
        if (!metadata) throw new Error(`No chain config found for ${chain}`);
        if (metadata.protocol !== ProtocolType.Ethereum)
            throw new Error("Only Ethereum chains are supported for now");
        const signer = multiProvider.getSigner(chain);
        assertSigner(signer);
        //   logGreen(`✅ ${metadata.displayName ?? chain} signer is valid`);
    }

    await nativeBalancesAreSufficient(
        multiProvider,
        chainsToGasCheck ?? chains,
        minGas,
    );


}

export async function completeDeploy(
    multiProvider : MultiProvider , 
    initialBalances: Record<string, BigNumber>,
    userAddress: Address | null,
    chains: ChainName[]
) {
    if (chains.length > 0) console.log(`⛽️ Gas Usage Statistics`);
    for (const chain of chains) {
        const provider = multiProvider.getProvider(chain);
        const address =
            userAddress ?? (await multiProvider.getSigner(chain).getAddress());
        const currentBalance = await provider.getBalance(address);
        const balanceDelta = initialBalances[chain].sub(currentBalance);
    }
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

export async function runCoreDeploy ( config : ChainConfig , registry : BaseRegistry ) { 
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
    let apiKeys = await requestAndSaveApiKeys([chain], chainMetadata, registry);

    const initialBalances = await prepareDeploy( userAddress , [chain] , multiProvider  )


    //TODO : implementation of furter steps


    await runDeployPlanStep( chainMetadata , chain , multiProvider  )

    await runPreflightChecksForChains( multiProvider , [chain] , MINIMUM_CORE_DEPLOY_GAS )

    const contractVerifier = new ContractVerifier(
        multiProvider , 
        apiKeys , 
        coreBuildArtifact , 
        ExplorerLicenseType.MIT
    );


    const evmCoreModule = await EvmCoreModule.create({ 
        chain , 
        config , //To be fetched rather its the incorrect one rather 
        multiProvider , 
        contractVerifier 
    })

    await completeDeploy( multiProvider , initialBalances , userAddress , [chain] )


    const deployedAddress = evmCoreModule.serialize()

    console.log(deployedAddress)
}

export async function createAgentConfigs (
    registry: BaseRegistry , 
    multiProvider: MultiProvider ,
    chains ?: string [] , 
    out : string
) {
    const addresses = await registry.getAddresses();

    const chainAddresses = filterAddresses(addresses, chains);
    if (!chainAddresses) {
        console.error("No chain addresses found");
        throw new Error("No chain addresses found");
    }

    const core = HyperlaneCore.fromAddressesMap(chainAddresses, multiProvider);

    const startBlocks = await getStartBlocks(
        chainAddresses,
        core,
        chainMetadata
    );

    await handleMissingInterchainGasPaymaster(chainAddresses);

    const agentConfig = buildAgentConfig(
        Object.keys(chainAddresses),
        multiProvider,
        chainAddresses as ChainMap<HyperlaneDeploymentArtifacts>,
        startBlocks
    );

    await validateAgentConfig(agentConfig);

    console.log(`\nWriting agent config to file ${out}`);

    writeYamlOrJson(out, agentConfig, "json");

    console.log(`Agent config written to ${out}`);

}