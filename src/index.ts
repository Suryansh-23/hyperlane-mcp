import { GithubRegistry } from "@hyperlane-xyz/registry";
import {
  ChainMap,
  ChainMetadata,
  MultiProvider,
  TokenType,
  WarpCoreConfigSchema,
  WarpRouteDeployConfig,
} from "@hyperlane-xyz/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import URITemplate from "uri-templates";
import * as yaml from "yaml";
import { z } from "zod";
import { assetTransfer } from "./assetTransfer.js";
import { LocalRegistry } from "./localRegistry.js";
import { msgTransfer } from "./msgTransfer.js";
import { TYPE_CHOICES } from "./types.js";
import { privateKeyToSigner } from "./utils.js";
import { createWarpRouteDeployConfig, deployWarpRoute } from "./warpRoute.js";

// Load environment variables from .env file
config();

// Create server instance
const server = new McpServer(
  {
    name: "hyperlane-mcp",
    version: "1.0.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  },
  {
    capabilities: {
      logging: {
        jsonrpc: "2.0",
        id: 1,
        method: "logging/setLevel",
        params: {
          level: "info",
        },
      },
      resources: {
        subscribe: true,
      },
    },
  }
);

// Create directory for hyperlane-mcp if it doesn't exist
const homeDir = process.env.HOME!;
if (homeDir) {
  const mcpDir = path.join(homeDir, ".hyperlane-mcp");
  if (!fs.existsSync(mcpDir)) {
    fs.mkdirSync(mcpDir);
  }
}

// init key
const key = process.env.PRIVATE_KEY;
if (!key) {
  throw new Error("No private key provided");
}
const signer = privateKeyToSigner(key);

// Initialize Github Registry once for server
const githubRegistry = new GithubRegistry({
  authToken: process.env.GITHUB_TOKEN,
});

// Initialize Local Registry with Github Registry as source
const registry = new LocalRegistry({
  sourceRegistry: githubRegistry,
});

const URI_TEMPLATE_STRING = "hyperlane-warp:///{symbol}/{/chain*}";
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
          name: "warpRoute",
          description:
            "Hyperlane Warp Route for the given combination of symbol and chains. This can be fetched and used for asset transfers between chains.",
          mimeType: "application/json",
        },
      ],
    };
  }
);

server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const values = URI_TEMPLATE.fromUri(request.params.uri);
  server.server.sendLoggingMessage({
    level: "info",
    data: `Parsed URI values: ${JSON.stringify(values)}`,
  });

  const parsed = URI_OBJ_TEMPATE.safeParse(values);
  if (!parsed.success) {
    throw new Error("Invalid URI parameters");
  }

  let { symbol, chain } = parsed.data;
  chain = chain.filter((c) => c !== "");
  server.server.sendLoggingMessage({
    level: "info",
    data: `Fetching warp routes for symbol: ${typeof symbol}:${symbol} and chains: ${typeof chain}:${chain}`,
  });

  let warpRoutes;
  try {
    warpRoutes = await registry.getWarpRoutesBySymbolAndChains(symbol, chain);
  } catch (error) {
    server.server.sendLoggingMessage({
      level: "error",
      data: `Error fetching warp routes: ${error}`,
    });
    throw new Error(`Error fetching warp routes: ${error}`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        name: `Hyperlane Warp Route for ${symbol} on ${chain.join("-")}`,
        mimeType: "application/json",
        text: JSON.stringify(warpRoutes, null, 2),
      },
    ],
  };
});

server.tool(
  "cross-chain-message-transfer",
  "Transfers a cross-chain message.",
  {
    origin: z.string().describe("Origin chain"),
    destination: z.string().describe("Destination chain"),
    recipient: z
      .string()
      .length(42)
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address")
      .describe("Recipient address"),
    messageBody: z.string().describe("Message body"),
  },
  async ({ origin, destination, recipient, messageBody }) => {
    server.server.sendLoggingMessage({
      level: "info",
      data: `Starting cross-chain message transfer...
Parameters: origin=${origin}, destination=${destination}, recipient=${recipient}, messageBody=${messageBody}`,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: `Using signer with address: ${signer.address}`,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: "Initializing Github Registry...",
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
      level: "info",
      data: `Chain metadata fetched: ${JSON.stringify(chainMetadata, null, 2)}`,
    });

    const multiProvider = new MultiProvider(chainMetadata, {
      signers: {
        [origin]: signer,
        [destination]: signer,
      },
    });
    server.server.sendLoggingMessage({
      level: "info",
      data: `MultiProvider initialized with chains: ${JSON.stringify(
        multiProvider,
        null,
        2
      )}`,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: "Initiating message transfer...",
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
      level: "info",
      data: "Message transfer completed successfully",
    });

    return {
      content: [
        {
          type: "text",
          text: `Message dispatched successfully. Transaction Hash: ${dispatchTx.transactionHash}.\n Message ID for the dispatched message: ${message.id}`,
        },
      ],
    };
  }
);

server.tool(
  "cross-chain-asset-transfer",
  "Transfers an asset across chains for the specified token (specified in the WarpCoreConfig), amount, chains and recipient.\n" +
    "You can use the `deploy-warp-route` tool to deploy a warp route for the asset and chains.\n" +
    "You can use the `list-resources` tool to fetch the warp route config for the asset and chains.\n" +
    "This tool returns the transaction hash and message ID for the dispatched messages for each transfer between the chains.",
  {
    chains: z
      .array(z.string())
      .describe("Chains to transfer asset between in order of transfer"),
    amount: z.string().describe("Amount to transfer"),
    recipient: z
      .string()
      .length(42)
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address")
      .optional()
      .default(signer.address)
      .describe("Recipient address"),
    warpCoreConfig: WarpCoreConfigSchema.describe(
      "Warp core config for the asset transfer.\n" +
        "You can use fetch the warp route config using the resources.\n" +
        "If the warp config for the asset & chains doesn't exist. You can create it using the deploy-warp-route tool.\n" +
        "So, please make sure that a warp route config exists for the asset & chains before using this tool."
    ),
  },
  async ({ chains, amount, recipient, warpCoreConfig }) => {
    server.server.sendLoggingMessage({
      level: "info",
      data: `Starting cross-chain asset transfer...
Parameters: chains=${chains.join(
        ", "
      )}, amount=${amount}, recipient=${recipient}, warpCoreConfig=${JSON.stringify(
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
      level: "info",
      data: `MultiProvider initialized with chains: ${JSON.stringify(
        multiProvider,
        null,
        2
      )}`,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: "Initiating asset transfer...",
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
            type: "text",
            text: `Error in asset transfer. No delivery result couldn't be generated`,
          },
        ],
      };
    }

    server.server.sendLoggingMessage({
      level: "info",
      data: "Message transfer completed successfully",
    });

    return {
      content: [
        {
          mimeType: "application/json",
          type: "text",
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
  "deploy-warp-route",
  "Deploys a warp route.",
  {
    warpChains: z
      .array(z.string())
      .describe("Warp chains to deploy the route on"),
    tokenTypes: z
      .array(
        z.enum(
          TYPE_CHOICES.map((choice) => choice.name) as [string, ...string[]]
        )
      )
      .describe("Token types to deploy"),
  },
  async ({ warpChains, tokenTypes }) => {
    server.server.sendLoggingMessage({
      level: "info",
      data: `Deploying warp route with chains: ${warpChains.join(
        ", "
      )} and token types: ${tokenTypes.join(", ")}.`,
    });

    const fileName =
      warpChains.map((chain, i) => `${chain}:${tokenTypes[i]}`).join("-") +
      ".yaml";

    let warpRouteConfig: WarpRouteDeployConfig;
    const filePath = path.join(homeDir, ".hyperlane-mcp", fileName);

    if (fs.existsSync(filePath)) {
      server.server.sendLoggingMessage({
        level: "info",
        data: `Warp Route Already exists @ ${fileName} already exists. Skipping Config Creation.`,
      });

      const fileContent = fs.readFileSync(filePath, "utf-8");
      warpRouteConfig = yaml.parse(fileContent) as WarpRouteDeployConfig;

      return {
        content: [
          {
            type: "text",
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
        level: "info",
        data: `Creating Warp Route Config @ ${fileName}`,
      });

      warpRouteConfig = await createWarpRouteDeployConfig({
        warpChains,
        tokenTypes: tokenTypes.map(
          (t) => TokenType[t as keyof typeof TokenType]
        ),
        signerAddress: signer.address,
        registry,
        outPath: "./warpRouteDeployConfig.yaml",
      });

      server.server.sendLoggingMessage({
        level: "info",
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
      warpRouteConfig,
      filePath,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: `Warp route deployed successfully. Config: ${JSON.stringify(
        warpRouteConfig,
        null,
        2
      )}`,
    });

    return {
      content: [
        {
          type: "text",
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hello World MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
