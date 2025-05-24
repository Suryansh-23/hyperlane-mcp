import { AddWarpRouteOptions, BaseRegistry } from '@hyperlane-xyz/registry';
import {
  ChainMap,
  ChainMetadata,
  ChainName,
  DeployedOwnableConfig,
  getTokenConnectionId,
  HypERC20Deployer,
  HypERC20Factories,
  HypERC721Deployer,
  HypERC721Factories,
  HyperlaneContractsMap,
  isCollateralTokenConfig,
  IsmConfig,
  isTokenMetadata,
  isXERC20TokenConfig,
  MultiProvider,
  TOKEN_TYPE_TO_STANDARD,
  TokenFactories,
  TokenType,
  WarpCoreConfig,
  WarpRouteDeployConfig,
  WarpRouteDeployConfigSchema,
} from '@hyperlane-xyz/sdk';
import { assert, objMap, ProtocolType } from '@hyperlane-xyz/utils';
import fs from 'fs';
import { stringify } from 'yaml';
import { TYPE_CHOICES, WarpRouteDeployConfigMailboxRequired } from './types.js';

function restrictChoices(typeChoices: TokenType[]) {
  return TYPE_CHOICES.filter((choice) => typeChoices.includes(choice.name));
}

export async function createWarpRouteDeployConfig({
  warpChains,
  tokenTypes,
  signerAddress: owner,
  registry,
  outPath,
}: {
  warpChains: ChainName[];
  tokenTypes: TokenType[];
  signerAddress: string;
  registry: BaseRegistry;
  outPath: string;
}): Promise<WarpRouteDeployConfig> {
  //   logBlue("Creating a new warp route deployment config...");
  if (warpChains.length < 2 || tokenTypes.length < 2) {
    throw new Error(
      'At least two warp chains and two token types are required.'
    );
  }
  if (warpChains.length !== tokenTypes.length) {
    throw new Error(
      'The number of warp chains and token types must be the same.'
    );
  }

  const result: WarpRouteDeployConfig = {};
  let typeChoices = TYPE_CHOICES;
  let index = 0;
  for (const chain of warpChains) {
    // logBlue(`${chain}: Configuring warp route...`);

    const proxyAdmin: DeployedOwnableConfig | undefined = undefined;
    let interchainSecurityModule: IsmConfig | undefined = undefined;
    const type = tokenTypes[index];

    const isNft =
      type === TokenType.syntheticUri || type === TokenType.collateralUri;

    const mailbox = (await registry.getChainAddresses(chain))!.mailbox;

    switch (type) {
      case TokenType.collateral:
      case TokenType.XERC20:
      case TokenType.XERC20Lockbox:
      case TokenType.collateralFiat:
      case TokenType.collateralUri:
        // result[chain] = {
        //   type,
        //   owner,
        //   proxyAdmin,
        //   isNft,
        //   interchainSecurityModule,
        //   token: await input({
        //     message: `Enter the existing token address on chain ${chain}`,
        //   }),
        // };
        break;
      case TokenType.syntheticRebase:
        result[chain] = {
          type,
          owner,
          isNft,
          proxyAdmin,
          collateralChainName: '', // This will be derived correctly by zod.parse() below
          interchainSecurityModule,
          mailbox: '', // This will need to be set to the actual mailbox address
        };
        typeChoices = restrictChoices([
          TokenType.syntheticRebase,
          TokenType.collateralVaultRebase,
        ]);
        break;
      case TokenType.collateralVaultRebase:
        // result[chain] = {
        //   type,
        //   owner,
        //   proxyAdmin,
        //   isNft,
        //   interchainSecurityModule,
        //   token: await input({
        //     message: `Enter the ERC-4626 vault address on chain ${chain}`,
        //   }),
        // };

        // typeChoices = restrictChoices([TokenType.syntheticRebase]);
        break;
      case TokenType.collateralVault:
        // result[chain] = {
        //   type,
        //   owner,
        //   proxyAdmin,
        //   isNft,
        //   interchainSecurityModule,
        //   token: await input({
        //     message: `Enter the ERC-4626 vault address on chain ${chain}`,
        //   }),
        // };
        break;
      case TokenType.synthetic:
      case TokenType.syntheticUri:
        result[chain] = {
          type,
          owner,
          proxyAdmin,
          isNft,
          interchainSecurityModule,
          mailbox,
        };
        break;
      case TokenType.fastSynthetic:
        result[chain] = {
          type,
          owner,
          proxyAdmin,
          isNft,
          interchainSecurityModule,
          mailbox: '',
        };
        break;
      case TokenType.fastCollateral:
        result[chain] = {
          type,
          owner,
          proxyAdmin,
          isNft,
          interchainSecurityModule,
          token: '',
          mailbox,
        };
        break;
      case TokenType.native:
      case TokenType.nativeScaled:
        result[chain] = {
          type,
          owner,
          proxyAdmin,
          isNft,
          interchainSecurityModule,
          mailbox,
        };
    }

    index++;
  }

  try {
    const warpRouteDeployConfig = WarpRouteDeployConfigSchema.parse(result);
    // logBlue(`Warp Route config is valid, writing to file ${outPath}:\n`);
    // log(indentYamlOrJson(yamlStringify(warpRouteDeployConfig, null, 2), 4));
    // writeYaml(outPath, warpRouteDeployConfig);
    // logGreen("✅ Successfully created new warp route deployment config.");
    return warpRouteDeployConfig;
  } catch (e) {
    throw new Error(
      `Warp route deployment config is invalid: ${JSON.stringify(
        result
      )}. Error: ${e}`
    );
  }
}

export async function resolveWarpIsmAndHook(
  warpConfig: WarpRouteDeployConfigMailboxRequired,
  registry: BaseRegistry
): Promise<WarpRouteDeployConfigMailboxRequired> {
  return promiseObjAll(
    objMap(warpConfig, async (chain, config) => {
      const registryAddresses = await registry.getAddresses();
      const chainAddresses = registryAddresses[chain.toString()];

      if (!chainAddresses) {
        throw `Registry factory addresses not found for ${chain.toString()}.`;
      }

      return config;
    })
  );
}

export async function executeDeploy(
  config: WarpRouteDeployConfigMailboxRequired,
  multiProvider: MultiProvider,
  registry: BaseRegistry
): Promise<HyperlaneContractsMap<HypERC20Factories | HypERC721Factories>> {
  //   logBlue("🚀 All systems ready, captain! Beginning deployment...");
  const deployer = config.isNft
    ? new HypERC721Deployer(multiProvider)
    : new HypERC20Deployer(multiProvider); // TODO: replace with EvmERC20WarpModule

  // For each chain in WarpRouteConfig, deploy each Ism Factory, if it's not in the registry
  // Then return a modified config with the ism and/or hook address as a string
  const modifiedConfig = await resolveWarpIsmAndHook(config, registry);

  const deployedContracts = await deployer.deploy(modifiedConfig);

  //   logGreen("✅ Warp contract deployments complete");
  return deployedContracts;
}

function generateTokenConfigs(
  warpCoreConfig: WarpCoreConfig,
  warpDeployConfig: WarpRouteDeployConfigMailboxRequired,
  contracts: HyperlaneContractsMap<TokenFactories>,
  symbol: string,
  name: string,
  decimals: number
): void {
  for (const [chainName, contract] of Object.entries(contracts)) {
    const config = warpDeployConfig[chainName];
    const collateralAddressOrDenom =
      isCollateralTokenConfig(config) || isXERC20TokenConfig(config)
        ? config.token // gets set in the above deriveTokenMetadata()
        : undefined;

    warpCoreConfig.tokens.push({
      chainName,
      standard: TOKEN_TYPE_TO_STANDARD[config.type as TokenType],
      decimals,
      symbol: config.symbol || symbol,
      name,
      addressOrDenom:
        contract[warpDeployConfig[chainName].type as keyof TokenFactories]
          .address,
      collateralAddressOrDenom,
    });
  }
}

function fullyConnectTokens(warpCoreConfig: WarpCoreConfig): void {
  for (const token1 of warpCoreConfig.tokens) {
    for (const token2 of warpCoreConfig.tokens) {
      if (
        token1.chainName === token2.chainName &&
        token1.addressOrDenom === token2.addressOrDenom
      )
        continue;
      token1.connections ||= [];
      token1.connections.push({
        token: getTokenConnectionId(
          // @ts-ignore
          ProtocolType.Ethereum,
          token2.chainName,
          token2.addressOrDenom!
        ),
      });
    }
  }
}

export async function getWarpCoreConfig(
  warpDeployConfig: WarpRouteDeployConfig,
  multiProvider: MultiProvider,
  contracts: HyperlaneContractsMap<TokenFactories>
): Promise<{
  warpCoreConfig: WarpCoreConfig;
  addWarpRouteOptions?: AddWarpRouteOptions;
}> {
  const warpCoreConfig: WarpCoreConfig = { tokens: [] };

  // TODO: replace with warp read
  const tokenMetadata = await HypERC20Deployer.deriveTokenMetadata(
    multiProvider,
    warpDeployConfig
  );
  assert(
    tokenMetadata && isTokenMetadata(tokenMetadata),
    'Missing required token metadata'
  );
  const { decimals, symbol, name } = tokenMetadata;
  assert(decimals, 'Missing decimals on token metadata');

  generateTokenConfigs(
    warpCoreConfig,
    warpDeployConfig,
    contracts,
    symbol,
    name,
    decimals
  );

  fullyConnectTokens(warpCoreConfig);

  return { warpCoreConfig, addWarpRouteOptions: { symbol } };
}

export async function deployWarpRoute({
  registry,
  multiProvider,
  warpRouteDeployConfig: warpRouteConfig,
  filePath,
}: {
  registry: BaseRegistry;
  chainMetadata: ChainMap<ChainMetadata>;
  multiProvider: MultiProvider;
  warpRouteDeployConfig: WarpRouteDeployConfig;
  filePath: string;
}): Promise<WarpCoreConfig> {
  const deployedContracts = await executeDeploy(
    warpRouteConfig,
    multiProvider,
    registry
  );

  const { warpCoreConfig } = await getWarpCoreConfig(
    warpRouteConfig,
    multiProvider,
    deployedContracts
  );

  // NOT IMPLEMENTED YE
  // await registry.addWarpRoute(warpCoreConfig);
  await fs.promises.writeFile(filePath, stringify(warpCoreConfig, null, 2));

  return warpCoreConfig;
}

function promiseObjAll<K extends string, V>(obj: {
  [key in K]: Promise<V>;
}): Promise<Record<K, V>> {
  const promiseList = Object.entries(obj).map(([name, promise]) =>
    (promise as Promise<V>).then((result) => [name, result])
  );
  return Promise.all(promiseList).then(Object.fromEntries);
}
