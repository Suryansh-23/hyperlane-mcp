import { GithubRegistry } from "@hyperlane-xyz/registry";
import { ChainMap, ChainMetadata, MultiProvider } from "@hyperlane-xyz/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { ethers } from "ethers";
import { z } from "zod";
import { msgTransfer } from "./msgTransfer.js";
import { privateKeyToSigner } from "./utils.js";

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

    const key = process.env.PRIVATE_KEY;
    if (!key) {
      throw new Error("No private key provided");
    }
    server.server.sendLoggingMessage({
      level: "info",
      data: `Using signer with address: ${privateKeyToSigner(key).address}`,
    });

    const signer = privateKeyToSigner(key);

    server.server.sendLoggingMessage({
      level: "info",
      data: "Initializing Github Registry...",
    });
    const registry = new GithubRegistry({
      authToken: process.env.GITHUB_TOKEN,
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
      // providers: {
      //   [origin]: new ethers.providers.JsonRpcProvider(
      //     originChainMetadata.rpcUrls[0].http
      //   ),
      //   [destination]: new ethers.providers.JsonRpcProvider(
      //     destinationChainMetadata.rpcUrls[0].http
      //   ),
      // },
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hello World MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
