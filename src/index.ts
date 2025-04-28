import { GithubRegistry } from "@hyperlane-xyz/registry";
import { MultiProvider } from "@hyperlane-xyz/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ethers } from "ethers";
import { z } from "zod";
import { WriteCommandContext } from "./context.js";
import { msgTransfer } from "./msgTransfer.js";
import { privateKeyToSigner } from "./utils.js";
import { config } from "dotenv";

// Load environment variables from .env file
config();

// Create server instance
const server = new McpServer({
  name: "hello-world-mcp",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register hello world tool2232
server.tool("hello-world", "Returns a hello world message.", {}, async () => {
  return {
    content: [
      {
        type: "text",
        text: "Hello, world!",
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
    const chainMetadata = await registry.getMetadata();
    server.server.sendLoggingMessage({
      level: "info",
      data: `Chain metadata fetched: ${Object.keys(chainMetadata)}`,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: "Setting up MultiProvider...",
    });
    const multiProvider = new MultiProvider(chainMetadata, {
      signers: {
        holesky: signer,
        polygonamoy: signer,
      },
    });

    const context: WriteCommandContext = {
      registry: registry,
      multiProvider: multiProvider,
      skipConfirmation: true,
      key,
      signerAddress: signer.address,
      strategyPath: "path/to/strategy",
      signer,
    };
    server.server.sendLoggingMessage({
      level: "info",
      data: `Context initialized with signer address: ${context.signerAddress}`,
    });

    const sendOptions = {
      context: context,
      origin,
      destination,
      recipient,
      messageBody: ethers.utils.formatBytes32String(messageBody),
      timeoutSec: 120,
      skipWaitForDelivery: false,
    };
    server.server.sendLoggingMessage({
      level: "info",
      data: `Prepared message: ${sendOptions.messageBody}`,
    });

    server.server.sendLoggingMessage({
      level: "info",
      data: "Initiating message transfer...",
    });
    await msgTransfer({
      ...sendOptions,
    });
    server.server.sendLoggingMessage({
      level: "info",
      data: "Message transfer completed successfully",
    });

    return {
      content: [
        {
          type: "text",
          text: "Hello, world!",
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
