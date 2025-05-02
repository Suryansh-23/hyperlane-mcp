# Hyperlane MCP Server

A powerful MCP (Model Context Protocol) server that provides seamless integration with the Hyperlane protocol, enabling LLM assistants to interact with cross-chain messaging and smart contracts across multiple blockchains.

## Overview

This server connects LLM assistants to the Hyperlane ecosystem, enabling them to:

- Interact with multiple blockchain networks through Hyperlane
- Send and receive cross-chain messages
- Deploy and manage Hyperlane contracts
- Monitor message delivery and status
- Work with Hyperlane's registry and SDK

## Features

### Cross-Chain Messaging

- Send messages between different blockchain networks
- Monitor message delivery status
- Query message contents and metadata
- Handle message verification and execution

### Contract Interaction

- Deploy Hyperlane contracts
- Interact with existing Hyperlane contracts
- Query contract states across chains
- Manage contract configurations

### Network Management

- Connect to multiple blockchain networks
- Monitor network status and health
- Handle RPC connections and fallbacks
- Manage chain-specific configurations

### Utility Functions

- Convert between different chain IDs
- Handle message encoding/decoding
- Manage gas estimation across chains
- Work with Hyperlane's registry

## Installation

### Prerequisites

- Node.js v18+
- pnpm package manager
- Access to RPC endpoints for desired networks

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/hyperlane-mcp.git
   cd hyperlane-mcp
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   pnpm build
   ```

4. Configure your environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file with your configuration:
   ```
   # RPC URLs for different networks
   ETHEREUM_RPC_URL=your_ethereum_rpc_url
   POLYGON_RPC_URL=your_polygon_rpc_url
   # Add other network RPC URLs as needed

   # Optional: Private key for transactions
   PRIVATE_KEY=your_private_key
   ```

## Usage

### Starting the Server

```bash
pnpm start
```

### Using with MCP Clients

Configure your MCP client (e.g., Claude Desktop) with the following settings:

```json
{
  "mcpServers": {
    "hyperlane": {
      "command": "node",
      "args": [
        "path/to/hyperlane-mcp/build/index.js"
      ],
      "env": {
        "PRIVATE_KEY": "your_private_key"
      }
    }
  }
}
```

## Available Tools

### Message Operations

- `send_message`: Send a cross-chain message
- `get_message_status`: Check message delivery status
- `verify_message`: Verify message authenticity
- `decode_message`: Decode message contents

### Contract Operations

- `deploy_contract`: Deploy a new Hyperlane contract
- `query_contract`: Query contract state
- `update_contract`: Update contract configuration
- `get_contract_address`: Get contract address on specific chain

### Network Operations

- `get_chain_status`: Check chain health and status
- `get_network_config`: Get network configuration
- `validate_chain_id`: Validate chain ID format

## Examples

1. **Sending a Cross-Chain Message**:
```
Send a message from Ethereum to Polygon with the content "Hello from Ethereum!"
```

2. **Checking Message Status**:
```
Check the status of message ID 0x123...
```

3. **Deploying a Contract**:
```
Deploy a new Hyperlane contract on Ethereum mainnet
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Authors

- [Suryansh](https://github.com/Suryansh-23)
- [Ruddy](https://github.com/Ansh1902396)

## License

This project is licensed under the ISC License.

## Disclaimer

_The software is provided as is. No guarantee, representation or warranty is being made, express or implied, as to the safety or correctness of the software. It has not been audited and as such there can be no assurance it will work as intended. Users may experience delays, failures, errors, omissions, loss of transmitted information or loss of funds. The creators are not liable for any of the foregoing. Users should proceed with caution and use at their own risk._