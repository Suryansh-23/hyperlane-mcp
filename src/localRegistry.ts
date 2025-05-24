import {
  AddWarpRouteOptions,
  GithubRegistry,
  IRegistry,
  RegistryContent,
} from '@hyperlane-xyz/registry';
import {
  ChainMap,
  ChainMetadata,
  ChainName,
  WarpCoreConfig,
  WarpRouteDeployConfig,
} from '@hyperlane-xyz/sdk';
import crypto from 'crypto';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { readYamlOrJson } from './configOpts.js';

config();

// Define internal types to match registry types
interface WarpRouteFilterParams {
  chainName?: string;
  symbol?: string;
}

export interface UpdateChainParams {
  chainName: ChainName;
  metadata?: ChainMetadata;
  addresses?: ChainAddresses;
  deployAddresses?: Record<string, string>;
}

// Define internal types to match registry types
type ChainAddresses = Record<string, string>;
type WarpRouteConfigMap = Record<string, WarpCoreConfig>;
type WarpDeployConfigMap = Record<string, WarpRouteDeployConfig>;

export interface LocalRegistryOptions {
  sourceRegistry: IRegistry;
  storagePath?: string; // path to the parent dir that contains the `.hyperlane-mcp` dir
  logger?: any; // Match BaseRegistry's constructor parameter
}

/**
 * A registry that extends BaseRegistry and uses a local store for warp routes.
 * It delegates read operations to a provided registry (typically GithubRegistry),
 * but implements the write operation for warp routes.
 */
export class LocalRegistry extends GithubRegistry implements IRegistry {
  private sourceRegistry: IRegistry;
  private localWarpRoutes: WarpRouteConfigMap = {};
  private localWarpDeployConfigs: WarpDeployConfigMap = {};
  private localChainMetadata: Record<string, ChainMetadata> = {};
  private localChainDeployAddresses: Record<string, Record<string, string>> =
    {};

  private localStoragePath: string;

  // Define Model Context Protocol resource URIs for this registry
  static readonly MCP_ROUTES_URI = 'hyperlane-warp://registry/warp-routes';
  static readonly MCP_DEPLOY_CONFIG_URI_BASE = 'hyperlane-warp://';

  constructor(options: LocalRegistryOptions) {
    // Pass logger to BaseRegistry constructor if provided
    super(options.logger);

    this.sourceRegistry = options.sourceRegistry;
    this.localStoragePath =
      options.storagePath ||
      path.join(process.env.HOME || '.', '.hyperlane-mcp');

    // Create local storage directory if it doesn't exist
    if (!fs.existsSync(this.localStoragePath)) {
      fs.mkdirSync(this.localStoragePath, { recursive: true });
    }

    // Initialize local storage from existing files
    this.loadLocalStorage();
  }

  private loadLocalStorage(): void {
    try {
      // Load warp routes
      const routesDir = path.join(this.localStoragePath, 'routes');
      if (fs.existsSync(routesDir)) {
        const files = fs.readdirSync(routesDir);
        for (const file of files) {
          if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            const filePath = path.join(routesDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const config = parse(content) as WarpCoreConfig;
            const routeId = file.replace(/\.(yaml|yml)$/, '');
            this.localWarpRoutes[routeId] = config;
          }
        }
      } else {
        fs.mkdirSync(routesDir, { recursive: true });
      }

      // Load chain metadata (from chainName.yaml) and deploy addresses (from chainName.deploy.yaml)
      // These are stored in separate files and separate memory structures
      const chainsDir = path.join(this.localStoragePath, 'chains');
      if (fs.existsSync(chainsDir)) {
        const files = fs.readdirSync(chainsDir);

        // First pass: Load regular chain metadata files (chainName.yaml)
        for (const file of files) {
          // Skip deploy addresses files - they are loaded separately
          if (file.endsWith('.deploy.yaml') || file.endsWith('.deploy.yml')) {
            continue;
          }

          // Process regular chain metadata files
          if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            const filePath = path.join(chainsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const chainName = file.replace(/\.(yaml|yml)$/, '');

            // Load the metadata
            const metadata = parse(content) as ChainMetadata;
            this.localChainMetadata[chainName] = metadata;

            // Check if there's a corresponding deploy addresses file (.yaml or .yml extension)
            const deployAddressesPathYaml = path.join(
              chainsDir,
              `${chainName}.deploy.yaml`
            );
            const deployAddressesPathYml = path.join(
              chainsDir,
              `${chainName}.deploy.yml`
            );

            // Try .yaml extension first
            if (fs.existsSync(deployAddressesPathYaml)) {
              try {
                const deployContent = fs.readFileSync(
                  deployAddressesPathYaml,
                  'utf8'
                );
                const deployAddresses = parse(deployContent);

                // Store deploy addresses in the dedicated variable
                this.localChainDeployAddresses[chainName] = deployAddresses;
              } catch (error: any) {
                console.error(
                  `Error loading deploy addresses for ${chainName}:`,
                  error.message
                );
              }
            }
            // Try .yml extension if .yaml doesn't exist
            else if (fs.existsSync(deployAddressesPathYml)) {
              try {
                const deployContent = fs.readFileSync(
                  deployAddressesPathYml,
                  'utf8'
                );
                const deployAddresses = parse(deployContent);

                // Store deploy addresses in the dedicated variable
                this.localChainDeployAddresses[chainName] = deployAddresses;
              } catch (error: any) {
                console.error(
                  `Error loading deploy addresses for ${chainName}:`,
                  error.message
                );
              }
            }
          }
        }

        // Second pass: Explicitly look for all deploy address files
        // This ensures we load deploy addresses even if there's no corresponding metadata file
        for (const file of files) {
          if (file.endsWith('.deploy.yaml') || file.endsWith('.deploy.yml')) {
            try {
              const filePath = path.join(chainsDir, file);
              const content = fs.readFileSync(filePath, 'utf8');
              // Extract chain name by removing .deploy.yaml or .deploy.yml
              const chainName = file.replace(/\.deploy\.(yaml|yml)$/, '');
              const deployAddresses = parse(content);

              // Store deploy addresses only in the dedicated variable, never in metadata
              this.localChainDeployAddresses[chainName] = deployAddresses;
            } catch (error: any) {
              console.error(
                `Error loading deploy address file ${file}:`,
                error.message
              );
            }
          }
        }
      } else {
        fs.mkdirSync(chainsDir, { recursive: true });
      }
    } catch (error) {
      console.error('Error loading local storage:', error);
    }
  }

  // Implement addWarpRoute to match the BaseRegistry's method signature
  async addWarpRoute(
    config: WarpCoreConfig,
    options?: AddWarpRouteOptions
  ): Promise<void> {
    // Generate a route ID based on symbol or with internal method
    const routeId = this.generateRouteId(config, options?.symbol);

    // Store the config in memory
    this.localWarpRoutes[routeId] = config;

    // Create routes directory if it doesn't exist
    const routesDir = path.join(this.localStoragePath, 'routes');
    fs.mkdirSync(routesDir, { recursive: true });

    // Write the config to a file
    const filePath = path.join(routesDir, `${routeId}.yaml`);
    fs.writeFileSync(filePath, stringify(config, null, 2));

    this.logger.info(`Warp route added with ID: ${routeId}`);
  }

  private generateRouteId(config: WarpCoreConfig, symbol?: string): string {
    // Create a deterministic ID based on the token connections
    const tokens = config.tokens || [];
    const chainTokens = tokens
      .map((t) => `${t.chainName}:${t.addressOrDenom}`)
      .sort()
      .join('-');
    const baseId = symbol || tokens[0]?.symbol || 'unknown';

    // Add a hash for uniqueness if there are multiple routes with the same symbol
    const hash = crypto
      .createHash('sha256')
      .update(chainTokens)
      .digest('hex')
      .substring(0, 8);

    return `${baseId}-${hash}`;
  }

  // The following methods delegate to the source registry
  // with a fallback to local storage for warp routes

  getUri(itemPath?: string): string {
    return this.sourceRegistry.getUri(itemPath);
  }

  async listRegistryContent(): Promise<RegistryContent> {
    return this.sourceRegistry.listRegistryContent();
  }

  async getChains(): Promise<Array<ChainName>> {
    return this.sourceRegistry.getChains();
  }

  async getMetadata(): Promise<ChainMap<ChainMetadata>> {
    // Get metadata from source registry
    const sourceMetadata = await this.sourceRegistry.getMetadata();

    // Combine with local chain metadata
    return {
      ...sourceMetadata,
      ...this.localChainMetadata,
    };
  }

  async getChainMetadata(chainName: ChainName): Promise<ChainMetadata | null> {
    // First, check local chain metadata storage
    if (this.localChainMetadata[chainName]) {
      return this.localChainMetadata[chainName];
    }

    // If not found locally, fall back to source registry
    return this.sourceRegistry.getChainMetadata(chainName);
  }

  async getAddresses(): Promise<ChainMap<ChainAddresses>> {
    // Get addresses from source registry
    const sourceAddresses = await this.sourceRegistry.getAddresses();

    // Combine with local chain addresses
    const combinedAddresses: ChainMap<ChainAddresses> = { ...sourceAddresses };

    // Add addresses from local chain configs
    for (const [chainName, metadata] of Object.entries(
      this.localChainMetadata
    )) {
      // Regular addresses might be stored directly in the metadata object
      // Deploy addresses are never stored in metadata, always in separate files
      const chainConfig = metadata as any;

      // Check for regular addresses in metadata (deploy addresses are never in metadata)
      if (chainConfig.addresses && typeof chainConfig.addresses === 'object') {
        combinedAddresses[chainName] = {
          ...(combinedAddresses[chainName] || {}),
          ...chainConfig.addresses,
        };
      }

      // Check for deploy addresses in the dedicated variable
      if (
        this.localChainDeployAddresses[chainName] &&
        typeof this.localChainDeployAddresses[chainName] === 'object'
      ) {
        combinedAddresses[chainName] = {
          ...(combinedAddresses[chainName] || {}),
          ...this.localChainDeployAddresses[chainName],
        };
      }
    }

    return combinedAddresses;
  }

  async getChainAddresses(
    chainName: ChainName
  ): Promise<ChainAddresses | null> {
    // First, check for regular chain addresses in local metadata (from chainName.yaml)
    // Deploy addresses are never stored in metadata, always in separate chainName.deploy.yaml files
    if (this.localChainMetadata[chainName]) {
      const chainConfig = this.localChainMetadata[chainName] as any;
      if (chainConfig.addresses && typeof chainConfig.addresses === 'object') {
        return chainConfig.addresses;
      }
    }

    // If no regular addresses found, check for deploy addresses in the dedicated variable
    if (
      this.localChainDeployAddresses[chainName] &&
      typeof this.localChainDeployAddresses[chainName] === 'object'
    ) {
      return this.localChainDeployAddresses[chainName] as ChainAddresses;
    }

    // If not in memory, check for deploy addresses files
    const chainsDir = path.join(this.localStoragePath, 'chains');
    const deployAddressesPathYaml = path.join(
      chainsDir,
      `${chainName}.deploy.yaml`
    );
    const deployAddressesPathYml = path.join(
      chainsDir,
      `${chainName}.deploy.yml`
    );

    // Try yaml extension first
    if (fs.existsSync(deployAddressesPathYaml)) {
      try {
        const deployAddresses = readYamlOrJson(deployAddressesPathYaml, 'yaml');
        if (deployAddresses && typeof deployAddresses === 'object') {
          // Cache in dedicated variable
          this.localChainDeployAddresses[chainName] = deployAddresses as Record<
            string,
            string
          >;
          return deployAddresses as ChainAddresses;
        }
      } catch (error: any) {
        this.logger.warn(`Failed to read deploy addresses: ${error.message}`);
      }
    }
    // Try yml extension if yaml doesn't exist
    else if (fs.existsSync(deployAddressesPathYml)) {
      try {
        const deployAddresses = readYamlOrJson(deployAddressesPathYml, 'yaml');
        if (deployAddresses && typeof deployAddresses === 'object') {
          // Cache in dedicated variable
          this.localChainDeployAddresses[chainName] = deployAddresses as Record<
            string,
            string
          >;
          return deployAddresses as ChainAddresses;
        }
      } catch (error: any) {
        this.logger.warn(`Failed to read deploy addresses: ${error.message}`);
      }
    }

    // Fall back to source registry
    return this.sourceRegistry.getChainAddresses(chainName);
  }

  async addChain(params: UpdateChainParams): Promise<void> {
    const { chainName, metadata, deployAddresses } = params;

    if (!metadata || typeof metadata !== 'object') {
      throw new Error(
        `Invalid or missing chain config for "${chainName}": ${metadata} @ ${typeof metadata} # ${JSON.stringify(
          params
        )}`
      );
    }

    const yamlStr = stringify(metadata, null, 2);

    this.logger.info(`yamlStr: ${yamlStr}`);
    if (!yamlStr || typeof yamlStr !== 'string') {
      throw new Error(`Failed to serialize config for "${chainName}"`);
    }

    // cache in memory - regular chain metadata only, never includes deploy addresses
    this.localChainMetadata[chainName] = metadata as unknown as ChainMetadata;

    // Ensure the chains directory exists
    const chainsDir = path.join(this.localStoragePath, 'chains');
    fs.mkdirSync(chainsDir, { recursive: true });

    // Write regular metadata file (chainName.yaml) - never includes deploy addresses
    const filePath = path.join(chainsDir, `${chainName}.yaml`);
    this.logger.info(`filePath for metadata: ${filePath}`);
    fs.writeFileSync(filePath, yamlStr);

    // Write deploy addresses to a separate file if provided
    if (deployAddresses && Object.keys(deployAddresses).length > 0) {
      const deployAddressesPath = path.join(
        chainsDir,
        `${chainName}.deploy.yaml`
      );
      this.logger.info(`filePath for deploy addresses: ${deployAddressesPath}`);
      fs.writeFileSync(
        deployAddressesPath,
        stringify(deployAddresses, null, 2)
      );

      // Store deploy addresses in the dedicated variable
      this.localChainDeployAddresses[chainName] = deployAddresses;
    }

    this.logger.info(`✅  Chain added → ${chainName}`);
  }

  async updateChain(chains: UpdateChainParams): Promise<void> {
    this.logger.info(`Updating chain: ${JSON.stringify(chains, null, 2)}`);
    const chainsDir = path.join(this.localStoragePath, 'chains');

    // Regular addresses go into chainName.yaml with other metadata
    const metadataFilePath = path.join(chainsDir, `${chains.chainName}.yaml`);

    // Update regular addresses in chain metadata file if provided
    if (chains.addresses) {
      // First, load the existing metadata file
      let chainConfig;
      try {
        chainConfig = readYamlOrJson(metadataFilePath, 'yaml');
        this.logger.info(
          `Existing chainConfig: ${JSON.stringify(chainConfig, null, 2)}`
        );
      } catch (error) {
        this.logger.warn(
          `Could not read metadata file for ${chains.chainName}, creating new one`
        );
        chainConfig = {};
      }

      if (typeof chainConfig !== 'object' || chainConfig === null) {
        throw new Error(`Invalid chain config format for ${chains.chainName}`);
      }

      // Update the regular addresses in the metadata
      const updatedConfig = {
        ...chainConfig,
        addresses: chains.addresses,
      };

      // Write back to chainName.yaml and update in-memory metadata
      fs.writeFileSync(metadataFilePath, stringify(updatedConfig, null, 2));
      // Cast to unknown first to avoid type check issues since we're just updating a property
      this.localChainMetadata[chains.chainName] =
        updatedConfig as unknown as ChainMetadata;
      this.logger.info(
        `Updated regular addresses in metadata for ${chains.chainName}`
      );
    }

    // Deploy addresses are always stored in a separate chainName.deploy.yaml file
    if (chains.deployAddresses) {
      const deployAddressesPath = path.join(
        chainsDir,
        `${chains.chainName}.deploy.yaml`
      );

      // Check if deploy addresses file exists to determine whether to update or create
      let existingDeployAddresses = {};
      if (fs.existsSync(deployAddressesPath)) {
        try {
          existingDeployAddresses = readYamlOrJson(deployAddressesPath, 'yaml');
          if (
            typeof existingDeployAddresses !== 'object' ||
            existingDeployAddresses === null
          ) {
            existingDeployAddresses = {};
          }
        } catch (error: any) {
          this.logger.warn(
            `Failed to read existing deploy addresses: ${error.message}`
          );
        }
      }

      // Merge with existing deploy addresses if any
      const updatedDeployAddresses = {
        ...existingDeployAddresses,
        ...chains.deployAddresses,
      };

      // Write updated deploy addresses to the dedicated file (always separate from metadata)
      fs.writeFileSync(
        deployAddressesPath,
        stringify(updatedDeployAddresses, null, 2)
      );

      // Store in the dedicated variable (never in metadata)
      this.localChainDeployAddresses[chains.chainName] = updatedDeployAddresses;

      this.logger.info(`Updated deploy addresses in ${deployAddressesPath}`);
    }
  }

  async removeChain(_chains: ChainName): Promise<void> {
    throw new Error('Method not implemented in LocalRegistry');
  }

  async getWarpRoute(routeId: string): Promise<WarpCoreConfig | null> {
    // Check local storage first
    if (this.localWarpRoutes[routeId]) {
      return this.localWarpRoutes[routeId];
    }

    // Fall back to source registry
    return this.sourceRegistry.getWarpRoute(routeId);
  }

  async getWarpDeployConfig(
    routeId: string
  ): Promise<WarpRouteDeployConfig | null> {
    // Check local storage first
    if (this.localWarpDeployConfigs[routeId]) {
      return this.localWarpDeployConfigs[routeId];
    }

    // Fall back to source registry
    return this.sourceRegistry.getWarpDeployConfig(routeId);
  }

  async getWarpRoutes(
    filter?: WarpRouteFilterParams
  ): Promise<WarpRouteConfigMap> {
    // Get routes from source registry
    const sourceRoutes = await this.sourceRegistry.getWarpRoutes(filter);

    // Combine with local routes
    const combinedRoutes = { ...sourceRoutes };

    // Apply filtering to local routes and add to combined routes
    for (const [routeId, config] of Object.entries(this.localWarpRoutes)) {
      if (!filter) {
        combinedRoutes[routeId] = config;
        continue;
      }

      // Check if the route matches the filter
      const { chainName, symbol } = filter;
      let matches = true;

      if (chainName) {
        const hasChain = config.tokens.some(
          (token) => token.chainName === chainName
        );
        if (!hasChain) {
          matches = false;
        }
      }

      if (symbol && matches) {
        const hasSymbol = config.tokens.some(
          (token) => token.symbol === symbol
        );
        if (!hasSymbol) {
          matches = false;
        }
      }

      if (matches) {
        combinedRoutes[routeId] = config;
      }
    }

    return combinedRoutes;
  }

  /**
   * Finds all warp routes filtering by symbol and/or chains
   * This method is also exposed as a Model Context Protocol resource at:
   * hyperlane-warp://registry/warp-routes#sym:getWarpRoutesBySymbolAndChains
   *
   * @param symbol Optional token symbol to search for
   * @param chainNames Optional array of chain names that should all be included in the routes
   * @returns Array of WarpCoreConfig objects that match the criteria (empty if none found)
   */
  async getWarpRoutesBySymbolAndChains(
    symbol?: string,
    chainNames?: string[]
  ): Promise<WarpCoreConfig[]> {
    try {
      // Get routes based on available filters
      const symbolRoutes = symbol
        ? await this.getWarpRoutes({ symbol })
        : await this.getWarpRoutes();

      // If no chainNames specified, return all routes matching the symbol (or all routes)
      if (!chainNames || chainNames.length === 0) {
        return Object.values(symbolRoutes);
      }

      // Array to hold all matching configs
      const matchingConfigs: WarpCoreConfig[] = [];

      // Filter routes to find all that include ALL specified chains
      for (const [_, config] of Object.entries(symbolRoutes)) {
        // Skip routes without tokens
        if (!config.tokens || config.tokens.length === 0) continue;

        // Check if all requested chains are present in this route
        const routeChains = new Set(
          config.tokens.map((token) => token.chainName)
        );
        const allChainsPresent = chainNames.every((chain) =>
          routeChains.has(chain)
        );

        if (allChainsPresent) {
          matchingConfigs.push(config);
        }
      }

      return matchingConfigs;
    } catch (error) {
      console.error('Error in getWarpRoutesBySymbolAndChains:', error);
      // Never raise an error, return empty array instead
      return [];
    }
  }

  async getWarpDeployConfigs(
    filter?: WarpRouteFilterParams
  ): Promise<WarpDeployConfigMap> {
    // This method follows the same pattern as getWarpRoutes
    const sourceConfigs = await this.sourceRegistry.getWarpDeployConfigs(
      filter
    );

    // Combine with local configs (if any)
    return { ...sourceConfigs, ...this.localWarpDeployConfigs };
  }

  /**
   * Finds all warp route deployment configs filtering by symbol and/or chains
   * This method is also exposed as a Model Context Protocol resource at:
   * hyperlane-warp://[symbol]/[chain1]-[chain2]-...-[chainN]
   *
   * @param symbol Optional token symbol to search for
   * @param chainNames Optional array of chain names that should all be included in the routes
   * @returns Array of WarpRouteDeployConfig objects that match the criteria (empty if none found)
   */
  async getWarpDeployConfigsBySymbolAndChains(
    symbol: string,
    chainNames?: string[]
  ): Promise<WarpRouteDeployConfig[]> {
    try {
      // First get matching route IDs based on symbol and chains
      const matchingRoutes = await this.getWarpRoutesBySymbolAndChains(
        symbol,
        chainNames
      );

      // Array to hold all matching deployment configs
      const deployConfigs: WarpRouteDeployConfig[] = [];

      // For each matching route, try to get its deployment config
      for (const route of matchingRoutes) {
        // Generate route ID the same way as in addWarpRoute
        const routeId = this.generateRouteId(route, symbol);

        const deployConfig = await this.getWarpDeployConfig(routeId);
        if (deployConfig) {
          deployConfigs.push(deployConfig);
        }
      }

      return deployConfigs;
    } catch (error) {
      console.error('Error in getWarpDeployConfigsBySymbolAndChains:', error);
      // Never raise an error, return empty array instead
      return [];
    }
  }
}
