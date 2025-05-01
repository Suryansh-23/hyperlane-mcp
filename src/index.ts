import { GithubRegistry } from "@hyperlane-xyz/registry";
import {
  ChainMap,
  ChainMetadata,
  MultiProvider,
  TokenType,
  WarpRouteDeployConfig,
} from "@hyperlane-xyz/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import * as yaml from "yaml";
import { z } from "zod";
import { msgTransfer } from "./msgTransfer.js";
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
const registry = new GithubRegistry({
  authToken: process.env.GITHUB_TOKEN,
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

const TYPE_DESCRIPTIONS: Record<TokenType, string> = {
  [TokenType.synthetic]: "A new ERC20 with remote transfer functionality",
  [TokenType.syntheticRebase]: `A rebasing ERC20 with remote transfer functionality. Must be paired with ${TokenType.collateralVaultRebase}`,
  [TokenType.collateral]:
    "Extends an existing ERC20 with remote transfer functionality",
  [TokenType.native]:
    "Extends the native token with remote transfer functionality",
  [TokenType.collateralVault]:
    "Extends an existing ERC4626 with remote transfer functionality. Yields are manually claimed by owner.",
  [TokenType.collateralVaultRebase]:
    "Extends an existing ERC4626 with remote transfer functionality. Rebases yields to token holders.",
  [TokenType.collateralFiat]:
    "Extends an existing FiatToken with remote transfer functionality",
  [TokenType.XERC20]:
    "Extends an existing xERC20 with Warp Route functionality",
  [TokenType.XERC20Lockbox]:
    "Extends an existing xERC20 Lockbox with Warp Route functionality",
  // TODO: describe
  [TokenType.syntheticUri]: "",
  [TokenType.collateralUri]: "",
  [TokenType.nativeScaled]: "",
  [TokenType.fastSynthetic]: "",
  [TokenType.fastCollateral]: "",
};
export const TYPE_CHOICES = Object.values(TokenType).map((type) => ({
  name: type,
  value: type,
  description: TYPE_DESCRIPTIONS[type],
}));

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
