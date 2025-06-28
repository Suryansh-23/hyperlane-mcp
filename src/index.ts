import { GithubRegistry } from '@hyperlane-xyz/registry';
import {
  ChainMap,
  ChainMetadata,
  MultiProvider,
  TokenType,
  WarpCoreConfigSchema,
  WarpRouteDeployConfig,
} from '@hyperlane-xyz/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import URITemplate from 'uri-templates';
import * as yaml from 'yaml';
import { z } from 'zod';
import { assetTransfer } from './assetTransfer.js';
import { LocalRegistry } from './localRegistry.js';
import { msgTransfer } from './msgTransfer.js';
import { TYPE_CHOICES } from './types.js';
import { privateKeyToSigner } from './utils.js';
import { createWarpRouteDeployConfig, deployWarpRoute } from './warpRoute.js';

import { ProtocolType } from '@hyperlane-xyz/utils';
import {
  createAgentConfigs,
  createChainConfig,
  loadChainDeployConfig,
  runCoreDeploy,
} from './hyperlaneDeployer.js';
import { RelayerRunner } from './RunRelayer.js';
import { ValidatorRunner } from './RunValidator.js';
import logger from './logger.js';

// Load environment variables from .env file
config();

// Create server instance
const server = new McpServer(
  {
    name: 'hyperlane-mcp',
    version: '1.0.0',
    capabilities: {
      resources: {},
      tools: {},
    },
  },
  {
    capabilities: {
      logging: {
        jsonrpc: '2.0',
        id: 1,
        method: 'logging/setLevel',
        params: {
          level: 'info',
        },
      },
      resources: {
        subscribe: true,
      },
    },
  }
);

// Create directory for hyperlane-mcp if it doesn't exist
const homeDir = process.env.CACHE_DIR || process.env.HOME;
let mcpDir;
if (homeDir) {
  mcpDir = path.join(homeDir, '.hyperlane-mcp');
  if (!fs.existsSync(mcpDir)) {
    fs.mkdirSync(mcpDir);
  }
} else {
  throw new Error(
    'Environment variable CACHE_DIR or HOME not set. Set it to a valid directory path.'
  );
}

// init key
const key = process.env.PRIVATE_KEY;
if (!key) {
  throw new Error('No private key provided');
}
const signer = privateKeyToSigner(key);

// Initialize Github Registry once for server
const githubRegistry = new GithubRegistry({
  authToken: process.env.GITHUB_TOKEN,
});

// Initialize Local Registry with Github Registry as source
const registry = new LocalRegistry({
  sourceRegistry: githubRegistry,
  storagePath: path.join(homeDir, '.hyperlane-mcp'),
  logger,
});

// logger.info(JSON.stringify(await registry.getAddresses()));
// logger.info(JSON.stringify(await registry.getWarpRoutes()));

const URI_TEMPLATE_STRING = 'hyperlane-warp:///{symbol}/{/chain*}';
const URI_TEMPLATE = URITemplate(URI_TEMPLATE_STRING);
const URI_OBJ_TEMPATE = z.object({
  symbol: z.string(),
  chain: z.array(z.string()),
});

server.server.setRequestHandler(
  ListResourceTemplatesRequestSchema,
  async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: URI_TEMPLATE_STRING,
          name: 'warpRoute',
          description:
            'Hyperlane Warp Route for the given combination of symbol and chains. This can be fetched and used for asset transfers between chains.',
          mimeType: 'application/json',
        },
      ],
    };
  }
);

server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const values = URI_TEMPLATE.fromUri(request.params.uri);
  server.server.sendLoggingMessage({
    level: 'info',
    data: `Parsed URI values: ${JSON.stringify(values)}`,
  });

  const parsed = URI_OBJ_TEMPATE.safeParse(values);
  if (!parsed.success) {
    throw new Error('Invalid URI parameters');
  }

  let { symbol, chain } = parsed.data;
  chain = chain.filter((c) => c !== '');
  server.server.sendLoggingMessage({
    level: 'info',
    data: `Fetching warp routes for symbol: ${typeof symbol}:${symbol} and chains: ${typeof chain}:${JSON.stringify(
      chain
    )}`,
  });

  let warpRoutes;
  try {
    warpRoutes = await registry.getWarpRoutesBySymbolAndChains(symbol, chain);
  } catch (error) {
    server.server.sendLoggingMessage({
      level: 'error',
      data: `Error fetching warp routes: ${error}`,
    });
    throw new Error(`Error fetching warp routes: ${error}`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        name: `Hyperlane Warp Route for ${symbol} on ${chain.join('-')}`,
        mimeType: 'application/json',
        text: JSON.stringify(warpRoutes, null, 2),
      },
    ],
  };
});

server.tool(
  'cross-chain-message-transfer',
  'Transfers a cross-chain message.',
  {
    origin: z.string().describe('Origin chain'),
    destination: z.string().describe('Destination chain'),
    recipient: z
      .string()
      .length(42)
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address')
      .describe('Recipient address'),
    messageBody: z.string().describe('Message body'),
  },
  async ({ origin, destination, recipient, messageBody }) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Starting cross-chain message transfer...
Parameters: origin=${origin}, destination=${destination}, recipient=${recipient}, messageBody=${messageBody}`,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Using signer with address: ${signer.address}`,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: 'Initializing Github Registry...',
    });

    registry.listRegistryContent();

    const originChainMetadata = (await registry.getChainMetadata(origin))!;
    const destinationChainMetadata = (await registry.getChainMetadata(
      destination
    ))!;

    const chainMetadata: ChainMap<ChainMetadata> = {
      [origin]: originChainMetadata,
      [destination]: destinationChainMetadata,
    };

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Chain metadata fetched: ${JSON.stringify(chainMetadata, null, 2)}`,
    });

    const multiProvider = new MultiProvider(chainMetadata, {
      signers: {
        [origin]: signer,
        [destination]: signer,
      },
    });
    server.server.sendLoggingMessage({
      level: 'info',
      data: `MultiProvider initialized with chains: ${JSON.stringify(
        multiProvider,
        null,
        2
      )}`,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: 'Initiating message transfer...',
    });

    const [dispatchTx, message] = await msgTransfer({
      origin,
      destination,
      recipient,
      messageBody: ethers.utils.formatBytes32String(messageBody),
      registry,
      multiProvider,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: 'Message transfer completed successfully',
    });

    return {
      content: [
        {
          type: 'text',
          text: `Message dispatched successfully. Transaction Hash: ${dispatchTx.transactionHash}.\n Message ID for the dispatched message: ${message.id}`,
        },
      ],
    };
  }
);

server.tool(
  'cross-chain-asset-transfer',
  'Transfers tokens/assets between multiple blockchain networks using Hyperlane\'s cross-chain infrastructure.\n\n' +
    'FUNCTIONALITY:\n' +
    '• Moves tokens from one blockchain to another (e.g., USDC from Ethereum to Polygon)\n' +
    '• Supports sequential transfers across multiple chains in a single operation\n' +
    '• Handles various token types including native tokens, ERC20 tokens, and synthetic tokens\n\n' +
    'PREREQUISITES:\n' +
    '• A warp route must exist for the specified token symbol and chain combination\n' +
    '• If no warp route exists, deploy one first using the `deploy-warp-route` tool\n' +
    '• Sufficient token balance on the origin chain\n' +
    '• Sufficient gas tokens on all involved chains for transaction fees\n\n' +
    'PARAMETERS:\n' +
    '• symbol: The token identifier (e.g., "USDC", "ETH", "WBTC")\n' +
    '• chains: Array of blockchain names in transfer order (e.g., ["ethereum", "polygon", "arbitrum"])\n' +
    '• amount: Token amount in wei or smallest token units (e.g., "1000000" for 1 USDC with 6 decimals)\n' +
    '• recipient: Destination wallet address (defaults to sender if not specified)\n\n' +
    'OUTPUT:\n' +
    '• Returns transaction hashes and message IDs for each cross-chain transfer\n' +
    '• Each transfer between adjacent chains generates one transaction\n' +
    '• Use message IDs to track delivery status across chains\n\n' +
    'EXAMPLE USE CASES:\n' +
    '• Bridge USDC from Ethereum to Polygon\n' +
    '• Multi-hop transfer: ETH from Ethereum → Arbitrum → Base\n' +
    '• Cross-chain token arbitrage or yield farming',
  {
    symbol: z.string().describe('Token symbol to transfer'),
    chains: z
      .array(z.string())
      .describe('Chains to transfer asset between in order of transfer'),
    amount: z.string().describe('Amount to transfer (in wei or token units)'),
    recipient: z
      .string()
      .length(42)
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address')
      .optional()
      .default(signer.address)
      .describe('Recipient address'),
  },
  async ({ symbol, chains, amount, recipient }) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Starting cross-chain asset transfer...
Parameters: symbol=${symbol}, chains=${chains.join(
        ', '
      )}, amount=${amount}, recipient=${recipient}`,
    });

    // Fetch warp route config from registry
    const warpRoutes = await registry.getWarpRoutesBySymbolAndChains(
      symbol,
      chains
    );

    if (!warpRoutes || warpRoutes.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No warp route config found for symbol "${symbol}" and chains [${chains.join(
              ', '
            )}]. Please deploy a warp route first using the 'deploy-warp-route' tool.`,
          },
        ],
      };
    }

    const warpCoreConfig = warpRoutes[0]; // Use the first matching config

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Found warp core config: ${JSON.stringify(
        warpCoreConfig,
        null,
        2
      )}`,
    });

    const chainMetadata: ChainMap<ChainMetadata> = Object.fromEntries(
      await Promise.all(
        chains.map(async (chain) => [
          chain,
          (await registry.getChainMetadata(chain))!,
        ])
      )
    );

    const multiProvider = new MultiProvider(chainMetadata, {
      signers: Object.fromEntries(chains.map((chain) => [chain, signer])),
      providers: Object.fromEntries(
        await Promise.all(
          chains.map(async (chain) => [
            chain,
            new ethers.providers.JsonRpcProvider(
              chainMetadata[chain].rpcUrls[0].http
            ),
          ])
        )
      ),
    });
    server.server.sendLoggingMessage({
      level: 'info',
      data: `MultiProvider initialized with chains: ${JSON.stringify(
        multiProvider,
        null,
        2
      )}`,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: 'Initiating asset transfer...',
    });

    const deliveryResult = await assetTransfer({
      warpCoreConfig,
      chains,
      amount,
      recipient,
      multiProvider,
    });
    if (!deliveryResult || deliveryResult.length !== chains.length - 1) {
      return {
        content: [
          {
            type: 'text',
            text: `Error in asset transfer. No delivery result couldn't be generated`,
          },
        ],
      };
    }

    server.server.sendLoggingMessage({
      level: 'info',
      data: 'Message transfer completed successfully',
    });

    return {
      content: [
        {
          mimeType: 'application/json',
          type: 'text',
          text: JSON.stringify(
            deliveryResult.map(([dispatchTx, message]) => ({
              transactionHash: dispatchTx.transactionHash,
              messageId: message.id,
            })),
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  'deploy-warp-route',
  'Deploys a warp route.',
  {
    warpChains: z
      .array(z.string())
      .describe('Warp chains to deploy the route on'),
    tokenTypes: z
      .array(
        z.enum(
          TYPE_CHOICES.map((choice) => choice.name) as [string, ...string[]]
        )
      )
      .describe('Token types to deploy'),
  },
  async ({ warpChains, tokenTypes }) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Deploying warp route with chains: ${warpChains.join(
        ', '
      )} and token types: ${tokenTypes.join(', ')}.`,
    });

    const fileName = `routes/${
      warpChains.map((chain, i) => `${chain}:${tokenTypes[i]}`).join('-') +
      '.yaml'
    }`;

    let warpRouteConfig: WarpRouteDeployConfig;
    const filePath = path.join(mcpDir, fileName);

    if (fs.existsSync(filePath)) {
      server.server.sendLoggingMessage({
        level: 'info',
        data: `Warp Route Already exists @ ${fileName} already exists. Skipping Config Creation.`,
      });

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      warpRouteConfig = yaml.parse(fileContent) as WarpRouteDeployConfig;

      return {
        content: [
          {
            type: 'text',
            text: `Warp Route Config already exists @ ${fileName}. Skipping Config Creation. Config: ${JSON.stringify(
              warpRouteConfig,
              null,
              2
            )}`,
          },
        ],
      };
    } else {
      server.server.sendLoggingMessage({
        level: 'info',
        data: `Creating Warp Route Config @ ${fileName}`,
      });

      warpRouteConfig = await createWarpRouteDeployConfig({
        warpChains,
        tokenTypes: tokenTypes.map(
          (t) => TokenType[t as keyof typeof TokenType]
        ),
        signerAddress: signer.address,
        registry,
        outPath: './warpRouteDeployConfig.yaml',
      });

      server.server.sendLoggingMessage({
        level: 'info',
        data: `Warp route deployment config created: ${JSON.stringify(
          warpRouteConfig,
          null,
          2
        )}`,
      });
    }

    const chainMetadata: ChainMap<ChainMetadata> = {};
    for (const chain of warpChains) {
      chainMetadata[chain] = (await registry.getChainMetadata(chain))!;
    }

    const multiProvider = new MultiProvider(chainMetadata, {
      signers: Object.fromEntries(warpChains.map((chain) => [chain, signer])),
    });

    const deploymentConfig = await deployWarpRoute({
      registry,
      chainMetadata,
      multiProvider,
      warpRouteDeployConfig: warpRouteConfig,
      filePath,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Warp route deployed successfully. Config: ${JSON.stringify(
        warpRouteConfig,
        null,
        2
      )}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Warp route deployment config created successfully. Config: ${JSON.stringify(
            deploymentConfig,
            null,
            2
          )}`,
        },
      ],
    };
  }
);

server.tool(
  'deploy-chain',
  'Deploys a new chain to the Hyperlane network.',
  {
    chainName: z.string().describe('Name of the chain to deploy'),
    chainId: z.number().describe('Chain ID of the chain to deploy'),
    rpcUrl: z.string().url().describe('RPC URL for the chain'),
    tokenSymbol: z.string().describe('Native token symbol'),
    tokenName: z.string().describe('Native token name'),
    isTestnet: z
      .boolean()
      .default(false)
      .describe('Whether this is a testnet chain'),
  },
  async ({ chainName, chainId, rpcUrl, tokenSymbol, tokenName, isTestnet }) => {
    const existingConfig = await loadChainDeployConfig(chainName);

    if (existingConfig) {
      server.server.sendLoggingMessage({
        level: 'info',
        data: `Chain deployment config already exists for ${chainName}. Using existing config.`,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Chain config already exists. Skipping config creation.\n${JSON.stringify(
              existingConfig,
              null,
              2
            )}`,
          },
        ],
      };
    }

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Deploying chain ${chainName} with ID ${chainId}...`,
    });

    // Step 1: Create Chain Config + Save
    const chainConfig = {
      chainName,
      chainId,
      rpcUrl,
      tokenSymbol,
      tokenName,
      isTestnet,
    };
    await createChainConfig({
      config: chainConfig,
      registry,
    });

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Chain config created successfully: ${JSON.stringify(
        chainConfig,
        null,
        2
      )}`,
    });

    // Step 2: Deploy Core Contracts
    const deployConfig = { config: chainConfig, registry };

    // server.server.sendLoggingMessage({
    //   level: 'info',
    //   data: `this is the deploy config: ${JSON.stringify(deployConfig, null, 2)}`,
    // });

    const deployedAddress = await runCoreDeploy(deployConfig);

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Core contracts deployed successfully for ${chainName}. Deployed address: ${JSON.stringify(
        deployedAddress,
        null,
        2
      )}`,
    });

    // Step 3: Create Agent Configs
    const metadata = {
      [chainName]: {
        name: chainName,
        displayName: chainName,
        chainId,
        domainId: chainId,
        protocol: ProtocolType.Ethereum,
        rpcUrls: [{ http: rpcUrl }],
        isTestnet,
      },
    } as ChainMap<ChainMetadata>;

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Create metadata for ${chainName}: ${JSON.stringify(
        metadata,
        null,
        2
      )}`,
    });

    const multiProvider = new MultiProvider(metadata, {
      signers: {
        [signer.address]: signer,
      },
    });

    const outPath = path.join(mcpDir, 'agents');
    await createAgentConfigs(registry, multiProvider, outPath, chainName);

    server.server.sendLoggingMessage({
      level: 'info',
      data: `✅ Chain deployment and agent config creation complete for ${chainName}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: `✅ Successfully deployed ${chainName} and generated agent config.\n\nSaved config: ${JSON.stringify(
            chainConfig,
            null,
            2
          )}`,
        },
      ],
    };
  }
);

server.tool(
  'run-validator',
  'Runs a validator for a specific chain.',
  {
    chainName: z.string().describe('Name of the chain to validate'),
  },
  async ({ chainName }) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Starting validator for chain: ${chainName}...`,
    });

    const configFilePath = path.join(
      mcpDir,
      `agents/${chainName}-agent-config.json`
    );

    server.server.sendLoggingMessage({
      level: 'info',
      data: `Config file path: ${configFilePath}`,
    });

    const validatorKey = process.env.PRIVATE_KEY;
    if (!validatorKey) {
      throw new Error('No private key provided');
    }

    try {
      const validatorRunner = new ValidatorRunner(
        chainName,
        validatorKey,
        configFilePath
      );
      await validatorRunner.run();

      return {
        content: [
          {
            type: 'text',
            text: `Validator started successfully for chain: ${chainName}`,
          },
        ],
      };
    } catch (error) {
      server.server.sendLoggingMessage({
        level: 'error',
        data: `Error starting validator for chain ${chainName}: ${error}`,
      });
      throw error;
    }
  }
);

server.tool(
  'run-relayer',
  'Runs a relayer for specified chains.',
  {
    relayChains: z.array(z.string()).describe('Chains to relay between'),
    validatorChainName: z.string().describe('Name of the validator chain'),
  },
  async ({ relayChains, validatorChainName }) => {
    server.server.sendLoggingMessage({
      level: 'info',
      data: `Starting relayer for chains: ${relayChains.join(', ')}...`,
    });

    const configFilePath = path.join(
      homeDir!,
      '.hyperlane-mcp',
      'agents',
      `${validatorChainName}-agent-config.json`
    );

    const relayerKey = process.env.PRIVATE_KEY;
    if (!relayerKey) {
      throw new Error('No private key provided');
    }

    try {
      const relayerRunner = new RelayerRunner(
        relayChains,
        relayerKey,
        configFilePath,
        validatorChainName
      );
      await relayerRunner.run();

      return {
        content: [
          {
            type: 'text',
            text: `Relayer started successfully for chains: ${relayChains.join(
              ', '
            )}`,
          },
        ],
      };
    } catch (error) {
      server.server.sendLoggingMessage({
        level: 'error',
        data: `Error starting relayer for chains ${relayChains.join(
          ', '
        )}: ${error}`,
      });
      throw error;
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Hyperlane MCP server started. Listening for requests...');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
