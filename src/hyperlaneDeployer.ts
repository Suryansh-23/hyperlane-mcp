import { buildArtifact as coreBuildArtifact } from "@hyperlane-xyz/core/buildArtifact.js";
import { BaseRegistry, chainMetadata, GithubRegistry } from "@hyperlane-xyz/registry";
import {
    buildAgentConfig,
    ChainMap,
    ChainMetadata,
    ChainMetadataSchema,
    ChainName,
    ContractVerifier,
    CoreConfig,
    CoreConfigSchema,
    EvmCoreModule,
    ExplorerLicenseType,
    HyperlaneCore,
    HyperlaneDeploymentArtifacts,
    IsmType,
    MultiProvider,
    OwnableConfig,
} from "@hyperlane-xyz/sdk";
import { Address, ProtocolType } from "@hyperlane-xyz/utils";
import { ethers, BigNumber } from "ethers";
import { stringify as yamlStringify } from "yaml";
import { writeYamlOrJson } from "./configOpts.js";
import path from "path";
import fs from "fs";

import { ChainConfig } from "./types.js";
import { addNativeTokenConfig, createMerkleTreeConfig, createMultisignConfig } from "./config.js";
import {
    confirmExistingMailbox,
    privateKeyToSigner,
    requestAndSaveApiKeys,
    transformChainMetadataForDisplay,
    assertSigner,
    nativeBalancesAreSufficient,
    filterAddresses,
    getStartBlocks,
    handleMissingInterchainGasPaymaster,
    validateAgentConfig
} from "./utils.js";
import { MINIMUM_CORE_DEPLOY_GAS } from "./consts.js";

export interface DeployConfig {
    userAddress: Address | null;
    chains: ChainName[];
    multiProvider: MultiProvider;
}

export interface ChainConfigOptions {
    config: ChainConfig;
    wantNativeTokenConfig: boolean;
    registry: BaseRegistry;
}

export interface CoreDeployConfig {
    config: ChainConfig;
    registry: BaseRegistry;
}

export async function prepareDeploy(config: DeployConfig): Promise<Record<string, BigNumber>> {
    const initialBalances: Record<string, BigNumber> = {};
    await Promise.all(
        config.chains.map(async (chain: ChainName) => {
            const provider = config.multiProvider.getProvider(chain);
            const address = config.userAddress ?? (await config.multiProvider.getSigner(chain).getAddress());
            const currentBalance = await provider.getBalance(address);
            initialBalances[chain] = currentBalance;
        })
    );
    return initialBalances;
}

export async function runDeployPlanStep(
    chainMetadata: ChainMap<ChainMetadata>,
    chain: ChainName,
    multiProvider: MultiProvider
): Promise<void> {
    const address = await multiProvider.getSigner(chain).getAddress();
    const transformChainMetadata = transformChainMetadataForDisplay(chainMetadata[chain]);

    console.log("\nDeployment plan");
    console.log("===============");
    console.log(`Transaction signer and owner of new contracts: ${address}`);
    console.log(`Deploying core contracts to network: ${chain}`);

    await confirmExistingMailbox(chain);
}

export async function runPreflightChecksForChains(
    multiProvider: MultiProvider,
    chains: ChainName[],
    minGas: string,
    chainsToGasCheck?: ChainName[]
): Promise<void> {
    if (!chains?.length) throw new Error("Empty chain selection");

    for (const chain of chains) {
        const metadata = multiProvider.tryGetChainMetadata(chain);
        if (!metadata) throw new Error(`No chain config found for ${chain}`);
        if (metadata.protocol !== ProtocolType.Ethereum)
            throw new Error("Only Ethereum chains are supported for now");
        const signer = multiProvider.getSigner(chain);
        assertSigner(signer);
    }

    await nativeBalancesAreSufficient(
        multiProvider,
        chainsToGasCheck ?? chains,
        minGas,
    );
}

export async function completeDeploy(
    multiProvider: MultiProvider,
    initialBalances: Record<string, BigNumber>,
    userAddress: Address | null,
    chains: ChainName[]
): Promise<void> {
    if (chains.length > 0) console.log(`⛽️ Gas Usage Statistics`);
    for (const chain of chains) {
        const provider = multiProvider.getProvider(chain);
        const address = userAddress ?? (await multiProvider.getSigner(chain).getAddress());
        const currentBalance = await provider.getBalance(address);
        const balanceDelta = initialBalances[chain].sub(currentBalance);
        console.log(`${chain}: ${ethers.utils.formatEther(balanceDelta)} ETH`);
    }
}

export async function createChainConfig(options: ChainConfigOptions): Promise<void> {
    const provider = new ethers.providers.JsonRpcProvider(options.config.rpcUrl);
    const metadata: ChainMetadata = {
        name: options.config.chainName,
        displayName: options.config.chainName,
        chainId: options.config.chainId,
        domainId: Number(options.config.chainId),
        protocol: ProtocolType.Ethereum,
        rpcUrls: [{
            http: options.config.rpcUrl
        }],
        isTestnet: options.config.isTestnet
    };

    await addNativeTokenConfig(
        metadata,
        { tokenSymbol: options.config.tokenSymbol, tokenName: options.config.tokenName },
        options.wantNativeTokenConfig
    );

    const parseResult = ChainMetadataSchema.safeParse(metadata);

    if (parseResult.success) {
        const metadataYaml = yamlStringify(metadata, {
            indent: 2,
            sortMapEntries: true,
        });

        await options.registry.addChain({ chainName: metadata.name, metadata });

        console.log("Chain metadata created", metadataYaml);
    } else {
        console.error(parseResult.error);
        throw new Error("Error in creating chain metadata");
    }
}

export async function InitializeDeployment(): Promise<CoreConfig> {
    const defaultIsm = await createMultisignConfig(IsmType.MERKLE_ROOT_MULTISIG);
    const defaultHook = await createMerkleTreeConfig();
    const requiredHook = await createMerkleTreeConfig();

    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY environment variable is required");
    }
    const owner = await privateKeyToSigner(process.env.PRIVATE_KEY);

    const proxyAdmin: OwnableConfig = {
        owner: owner.address
    };

    try {
        const coreConfig = CoreConfigSchema.parse({
            owner,
            defaultIsm,
            defaultHook,
            requiredHook,
            proxyAdmin,
        });

        return coreConfig;
    } catch (e) {
        console.error(e);
        throw new Error("Error in creating core config");
    }
}

export async function runCoreDeploy(config: CoreDeployConfig): Promise<void> {
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY environment variable is required");
    }
    const signer = await privateKeyToSigner(process.env.PRIVATE_KEY);
    const metadata: ChainMetadata = {
        name: config.config.chainName,
        displayName: config.config.chainName,
        chainId: config.config.chainId,
        domainId: Number(config.config.chainId),
        protocol: ProtocolType.Ethereum,
        rpcUrls: [{
            http: config.config.rpcUrl
        }],
        isTestnet: config.config.isTestnet
    };

    const multiProvider = new MultiProvider({
        [config.config.chainName]: metadata
    });

    const userAddress = signer.address;
    const chain = config.config.chainName;
    const apiKeys = await requestAndSaveApiKeys([chain], chainMetadata, config.registry);

    const initialBalances = await prepareDeploy({
        userAddress,
        chains: [chain],
        multiProvider
    });

    await runDeployPlanStep(chainMetadata, chain, multiProvider);
    await runPreflightChecksForChains(multiProvider, [chain], MINIMUM_CORE_DEPLOY_GAS);

    const contractVerifier = new ContractVerifier(
        multiProvider,
        apiKeys,
        coreBuildArtifact,
        ExplorerLicenseType.MIT
    );

    const coreConfig = await InitializeDeployment();
    const evmCoreModule = await EvmCoreModule.create({
        chain,
        config: coreConfig,
        multiProvider,
        contractVerifier
    });

    await completeDeploy(multiProvider, initialBalances, userAddress, [chain]);

    const deployedAddress = evmCoreModule.serialize();
    console.log(deployedAddress);
}

export async function createAgentConfigs(
    registry: BaseRegistry,
    multiProvider: MultiProvider,
    out: string,
    chains?: string[]
): Promise<void> {
    const addresses = await registry.getAddresses();
    const chainAddresses = filterAddresses(addresses, chains);
    
    if (!chainAddresses) {
        throw new Error("No chain addresses found");
    }

    const core = HyperlaneCore.fromAddressesMap(chainAddresses, multiProvider);
    const startBlocks = await getStartBlocks(chainAddresses, core, chainMetadata);
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

export function getChainDeployConfigPath(chainName: string): string {
    const homeDir = process.env.HOME || ".";
    const mcpDir = path.join(homeDir, ".hyperlane-mcp");
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(mcpDir)) {
        fs.mkdirSync(mcpDir, { recursive: true });
    }
    
    return path.join(mcpDir, `chain-${chainName}-deploy.yaml`);
}

export async function saveChainDeployConfig(config: ChainConfig): Promise<string> {
    const filePath = getChainDeployConfigPath(config.chainName);
    await writeYamlOrJson(filePath, config, "yaml");
    return filePath;
}

export async function loadChainDeployConfig(chainName: string): Promise<ChainConfig | null> {
    const filePath = getChainDeployConfigPath(chainName);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    return yamlStringify.parse(content) as ChainConfig;
}