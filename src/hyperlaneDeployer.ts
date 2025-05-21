import { BaseRegistry, chainMetadata } from '@hyperlane-xyz/registry';
import {
  buildAgentConfig,
  ChainMap,
  ChainMetadata,
  ChainMetadataSchema,
  ChainName,
  CoreConfig,
  CoreConfigSchema,
  EvmCoreModule,
  HyperlaneCore,
  HyperlaneDeploymentArtifacts,
  IsmType,
  MultiProvider,
  OwnableConfig,
} from '@hyperlane-xyz/sdk';
import { Address, ProtocolType } from '@hyperlane-xyz/utils';
import { BigNumber, ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { writeYamlOrJson } from './configOpts.js';

import {
  addNativeTokenConfig,
  createMerkleTreeConfig,
  createMultisignConfig,
} from './config.js';
import logger from './index.js';
import { ChainConfig } from './types.js';
import {
  assertSigner,
  confirmExistingMailbox,
  filterAddresses,
  getStartBlocks,
  handleMissingInterchainGasPaymaster,
  nativeBalancesAreSufficient,
  privateKeyToSigner,
  validateAgentConfig,
} from './utils.js';

export interface DeployConfig {
  userAddress: Address | null;
  chains: ChainName[];
  multiProvider: MultiProvider;
}

export interface ChainConfigOptions {
  config: ChainConfig;
  registry: BaseRegistry;
}

export interface CoreDeployConfig {
  config: ChainConfig;
  registry: BaseRegistry;
}

export async function prepareDeploy(
  config: DeployConfig
): Promise<Record<string, BigNumber>> {
  const initialBalances: Record<string, BigNumber> = {};
  await Promise.all(
    config.chains.map(async (chain: ChainName) => {
      const provider = config.multiProvider.getProvider(chain);
      const address =
        config.userAddress ??
        (await config.multiProvider.getSigner(chain).getAddress());
      const currentBalance = await provider.getBalance(address);
      initialBalances[chain] = currentBalance;
    })
  );
  return initialBalances;
}

export async function runDeployPlanStep(
  registry: BaseRegistry,
  chain: ChainName,
  multiProvider: MultiProvider
): Promise<void> {
  const address = await multiProvider.getSigner(chain).getAddress();

  logger.info('Deployment plan');
  logger.info('===============');
  logger.info(`Transaction signer and owner of new contracts: ${address}`);
  logger.info(`Deploying core contracts to network: ${chain}`);

  await confirmExistingMailbox(registry, chain);
}

export async function runPreflightChecksForChains(
  multiProvider: MultiProvider,
  chains: ChainName[],
  minGas: string,
  chainsToGasCheck?: ChainName[]
): Promise<void> {
  if (!chains?.length) throw new Error('Empty chain selection');

  for (const chain of chains) {
    const metadata = multiProvider.tryGetChainMetadata(chain);
    if (!metadata) throw new Error(`No chain config found for ${chain}`);
    if (metadata.protocol !== ProtocolType.Ethereum)
      throw new Error('Only Ethereum chains are supported for now');
    const signer = multiProvider.getSigner(chain);
    assertSigner(signer);
  }

  await nativeBalancesAreSufficient(
    multiProvider,
    chainsToGasCheck ?? chains,
    minGas
  );
}

export async function completeDeploy(
  multiProvider: MultiProvider,
  initialBalances: Record<string, BigNumber>,
  userAddress: Address | null,
  chains: ChainName[]
): Promise<void> {
  if (chains.length > 0) logger.info(`⛽️ Gas Usage Statistics`);
  for (const chain of chains) {
    const provider = multiProvider.getProvider(chain);
    const address =
      userAddress ?? (await multiProvider.getSigner(chain).getAddress());
    const currentBalance = await provider.getBalance(address);
    const balanceDelta = initialBalances[chain].sub(currentBalance);
    logger.info(`${chain}: ${ethers.utils.formatEther(balanceDelta)} ETH`);
  }
}

export async function createChainConfig(
  options: ChainConfigOptions
): Promise<void> {
  const provider = new ethers.providers.JsonRpcProvider(options.config.rpcUrl);
  const metadata: ChainMetadata = {
    name: options.config.chainName,
    displayName: options.config.chainName,
    chainId: options.config.chainId,
    domainId: Number(options.config.chainId),
    //@ts-ignore
    protocol: ProtocolType.Ethereum,
    rpcUrls: [
      {
        http: options.config.rpcUrl,
      },
    ],
    isTestnet: options.config.isTestnet,
  };

  await addNativeTokenConfig(metadata, {
    tokenSymbol: options.config.tokenSymbol,
    tokenName: options.config.tokenName,
  });

  logger.info(`Chain metadata: ${metadata}`);

  const parseResult = ChainMetadataSchema.safeParse(metadata);
  logger.info(`Chain metadata: ${parseResult}`);

  if (parseResult.success) {
    const metadataYaml = yamlStringify(metadata, {
      indent: 2,
      sortMapEntries: true,
    });

    await options.registry.addChain({ chainName: metadata.name, metadata });

    logger.info(`Chain metadata created: ${metadataYaml}`);
  } else {
    console.error(parseResult.error);
    // FIX: Properly format the error message using template literals
    throw new Error(
      `Error in creating chain metadata: ${JSON.stringify(metadata)}: ${
        parseResult.error
      }`
    );
  }
}

export async function InitializeDeployment(): Promise<CoreConfig> {
  const defaultIsm = await createMultisignConfig(IsmType.MERKLE_ROOT_MULTISIG);
  const defaultHook = await createMerkleTreeConfig();
  const requiredHook = await createMerkleTreeConfig();

  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const owner = await privateKeyToSigner(process.env.PRIVATE_KEY);

  const proxyAdmin: OwnableConfig = {
    owner: owner.address,
  };

  try {
    logger.info('Creating core ....');

    const coreConfig = CoreConfigSchema.parse({
      owner: owner.address,
      defaultIsm,
      defaultHook,
      requiredHook,
      proxyAdmin,
    });

    return coreConfig;
  } catch (e) {
    logger.error(`Error in creating core config: ${JSON.stringify(e)}`);
    throw new Error('Error in creating core config');
  }
}

export async function runCoreDeploy(
  config: CoreDeployConfig
): Promise<Record<string, string>> {
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  const signer = privateKeyToSigner(process.env.PRIVATE_KEY);
  const chain = config.config.chainName;

  const metadata: ChainMetadata = {
    name: chain,
    displayName: chain,
    chainId: config.config.chainId,
    domainId: Number(config.config.chainId),
    //@ts-ignore
    protocol: ProtocolType.Ethereum,
    rpcUrls: [
      {
        http: config.config.rpcUrl,
      },
    ],
    isTestnet: config.config.isTestnet,
  };

  const multiProvider = new MultiProvider(
    {
      [chain]: metadata,
    },
    {
      signers: {
        [chain]: signer,
      },
    }
  );

  const userAddress = signer.address;
  logger.info(`Preparing to deploy core contracts to ${chain}`);

  const initialBalances = await prepareDeploy({
    userAddress,
    chains: [chain],
    multiProvider,
  });

  logger.info(`Initial balances: ${initialBalances}`);

  await runDeployPlanStep(config.registry, chain, multiProvider);

  logger.info(`Predepoly checks complete`);

  const coreConfig = await InitializeDeployment();

  logger.info(`Core config: ${coreConfig}`);
  logger.info(`Creating core module...`);

  let evmCoreModule: EvmCoreModule;
  try {
    evmCoreModule = await EvmCoreModule.create({
      chain,
      config: coreConfig,
      multiProvider,
      // contractVerifier,
    });
  } catch (e) {
    logger.error(`Error in creating core module: ${e}`);
    throw new Error(`Error in creating core module: ${e}`);
  }

  logger.info(`Deploying core contracts to ${chain}`);

  await completeDeploy(multiProvider, initialBalances, userAddress, [chain]);
  const deployedAddresses = evmCoreModule.serialize();

  return deployedAddresses; // Return the deployed addresses as the function output
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
    throw new Error('No chain addresses found');
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
  logger.info(`\nWriting agent config to file ${out}`);
  writeYamlOrJson(out, agentConfig, 'json');
  logger.info(`Agent config written to ${out}`);
}

export function getChainDeployConfigPath(chainName: string): string {
  const homeDir = process.env.CACHE_DIR || process.env.HOME!;
  const mcpDir = path.join(homeDir, '.hyperlane-mcp');

  // Create directory if it doesn't exist
  if (!fs.existsSync(mcpDir)) {
    fs.mkdirSync(mcpDir, { recursive: true });
  }

  return path.join(mcpDir, `chain-${chainName}-deploy.yaml`);
}

export async function saveChainDeployConfig(
  config: ChainConfig
): Promise<string> {
  const filePath = getChainDeployConfigPath(config.chainName);
  await writeYamlOrJson(filePath, config, 'yaml');
  return filePath;
}

export async function loadChainDeployConfig(
  chainName: string
): Promise<ChainConfig | null> {
  const filePath = getChainDeployConfigPath(chainName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return yamlParse(content) as ChainConfig;
}
