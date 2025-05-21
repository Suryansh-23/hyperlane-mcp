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
      const routesDir = this.localStoragePath;
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
      }
    } catch (error) {
      console.error('Error loading local warp routes:', error);
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

    // Write the config to a file
    const filePath = path.join(this.localStoragePath, `${routeId}.yaml`);
    fs.writeFileSync(filePath, stringify(config, null, 2));

    this.logger.info(`Warp route added with ID: ${routeId}`);
  }

  //TODO : add chain functionality
  //TODO  : update chain functionality

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
    return this.sourceRegistry.getMetadata();
  }

  async getChainMetadata(chainName: ChainName): Promise<ChainMetadata | null> {
    return this.sourceRegistry.getChainMetadata(chainName);
  }

  async getAddresses(): Promise<ChainMap<ChainAddresses>> {
    return this.sourceRegistry.getAddresses();
  }

  async getChainAddresses(
    chainName: ChainName
  ): Promise<ChainAddresses | null> {
    return this.sourceRegistry.getChainAddresses(chainName);
  }

  async addChain(params: UpdateChainParams): Promise<void> {
    const { chainName, metadata } = params;

    if (!metadata || typeof metadata !== 'object') {
      throw new Error(
        `Invalid or missing chain config for "${chainName}": ${metadata} @ ${typeof metadata} # ${JSON.stringify(
          params
        )}`
      );
    }

    const yamlStr = stringify(metadata, null, 2);
    if (!yamlStr || typeof yamlStr !== 'string') {
      throw new Error(`Failed to serialize config for "${chainName}"`);
    }

    // cache in memory
    this.localChainMetadata[chainName] = metadata as unknown as ChainMetadata;

    const filePath = path.join(
      this.localStoragePath,
      'chains',
      `${chainName}.yaml`
    );

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yamlStr);

    this.logger.info(`✅  Chain added → ${chainName}`);
  }

  async updateChain(chains: UpdateChainParams): Promise<void> {
    return this.sourceRegistry.updateChain(chains);
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
    symbol: string,
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
