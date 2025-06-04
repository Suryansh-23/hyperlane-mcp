# Hyperlane MCP Server

A powerful Model Context Protocol (MCP) server that provides seamless integration with the Hyperlane protocol, enabling LLM assistants to interact with cross-chain messaging and smart contracts across multiple blockchains.

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Features](#features)
- [Requirements](#requirements)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Available Tools](#available-tools)
- [Project Structure](#project-structure)
- [Files & Folders Created](#files--folders-created)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Hyperlane MCP Server bridges the gap between LLM assistants and the Hyperlane cross-chain infrastructure. It provides a standardized interface for deploying chains, managing validators and relayers, sending cross-chain messages, and deploying warp routes for asset transfers.

## How It Works

### Architecture

The server operates as an MCP (Model Context Protocol) server that:

1. **Connects to Multiple Blockchains**: Uses Hyperlane's MultiProvider to manage connections to various blockchain networks
2. **Manages Local Registry**: Maintains a local cache of chain metadata, deployed contracts, and warp route configurations
3. **Deploys Infrastructure**: Handles deployment of Hyperlane core contracts, validators, and relayers
4. **Facilitates Cross-Chain Operations**: Enables message passing and asset transfers between chains
5. **Provides Docker Integration**: Runs validators and relayers in Docker containers for isolation

### Core Components

- **LocalRegistry**: Extends Hyperlane's registry system with local storage capabilities
- **HyperlaneDeployer**: Handles deployment of core Hyperlane contracts
- **ValidatorRunner**: Manages validator Docker containers
- **RelayerRunner**: Manages relayer Docker containers
- **WarpRoute**: Handles deployment and management of cross-chain asset routes

## Features

### Cross-Chain Messaging
- Send messages between different blockchain networks
- Monitor message delivery status
- Handle message verification and execution

### Contract Deployment & Management
- Deploy Hyperlane core contracts to new chains
- Deploy and configure warp routes for asset transfers
- Manage contract configurations and upgrades

### Infrastructure Management
- Run validators for message verification
- Run relayers for message delivery
- Monitor validator and relayer health
- Handle Docker container lifecycle

### Asset Transfers
- Deploy warp routes for cross-chain asset transfers
- Execute multi-hop asset transfers
- Support various token types (native, synthetic, collateral, etc.)

## Requirements

### System Requirements
- **Node.js**: v18 or higher
- **Package Manager**: pnpm (recommended)
- **Docker**: For running validators and relayers
- **Operating System**: Linux, macOS, or Windows with WSL2

### Network Requirements
- Access to RPC endpoints for target blockchain networks
- Stable internet connection for cross-chain operations
- Sufficient bandwidth for Docker image downloads

### Blockchain Requirements
- Private key with sufficient native tokens for gas fees
- Access to blockchain RPC endpoints
- Understanding of target chain configurations

## Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/hyperlane-mcp.git
cd hyperlane-mcp
```

### 2. Install Dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install project dependencies
pnpm install
```

### 3. Build the Project

```bash
pnpm build
```

### 4. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
# Required: Private key for signing transactions (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Required: GitHub Personal Access Token for registry access
GITHUB_TOKEN=your_github_personal_access_token

# Optional: Custom cache directory (defaults to ~/.hyperlane-mcp)
CACHE_DIR=/path/to/custom/cache/directory
```

### 5. Verify Docker Installation

```bash
# Ensure Docker is running
docker --version
docker ps
```

## Configuration

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `PRIVATE_KEY` | Yes | Private key for transaction signing (without 0x prefix) | None |
| `GITHUB_TOKEN` | Yes | GitHub PAT for accessing Hyperlane registry | None |
| `CACHE_DIR` | No | Directory for storing local data | `~/.hyperlane-mcp` |
| `HOME` | No | Home directory (fallback for CACHE_DIR) | System default |

### MCP Client Configuration

For Claude Desktop or other MCP clients, add this configuration:

```json
{
  "mcpServers": {
    "hyperlane": {
      "command": "node",
      "args": [
        "/path/to/hyperlane-mcp/build/index.js"
      ],
      "env": {
        "PRIVATE_KEY": "your_private_key",
        "GITHUB_TOKEN": "your_github_token"
        "CACHE_DIR": "your_cache_dir"
      }
    }
  }
}
```

## Usage

### Starting the Server

```bash
# Development mode
pnpm start

# Production mode
node build/index.js

# With MCP Inspector (for debugging)
pnpm inspect
```

### Basic Workflow

1. **Deploy a New Chain**: Use `deploy-chain` tool to add a new blockchain
2. **Run Validator**: Use `run-validator` to start message validation
3. **Run Relayer**: Use `run-relayer` to enable message delivery
4. **Deploy Warp Route**: Use `deploy-warp-route` for asset transfers
5. **Send Messages/Assets**: Use transfer tools for cross-chain operations

## Available Tools

### Chain Management
- **`deploy-chain`**: Deploy Hyperlane core contracts to a new chain
- **`run-validator`**: Start a validator for a specific chain
- **`run-relayer`**: Start a relayer for cross-chain message delivery

### Cross-Chain Operations
- **`cross-chain-message-transfer`**: Send messages between chains
- **`cross-chain-asset-transfer`**: Transfer assets using warp routes

### Warp Route Management
- **`deploy-warp-route`**: Deploy new warp routes for asset transfers

### Resources
- **Warp Route Configs**: Access via `hyperlane-warp:///{symbol}/{/chain*}` URI

## Project Structure

```
hyperlane-mcp/
├── src/                          # Source code
│   ├── index.ts                  # Main MCP server entry point
│   ├── localRegistry.ts          # Local registry implementation
│   ├── hyperlaneDeployer.ts      # Core contract deployment
│   ├── RunValidator.ts           # Validator Docker management
│   ├── RunRelayer.ts             # Relayer Docker management
│   ├── warpRoute.ts              # Warp route deployment
│   ├── msgTransfer.ts            # Message transfer logic
│   ├── assetTransfer.ts          # Asset transfer logic
│   ├── config.ts                 # Configuration utilities
│   ├── utils.ts                  # Utility functions
│   ├── types.ts                  # Type definitions
│   ├── logger.ts                 # Logging configuration
│   ├── gcr.ts                    # Google Container Registry utilities
│   ├── file.ts                   # File system utilities
│   ├── configOpts.ts             # Configuration options
│   └── consts.ts                 # Constants
├── build/                        # Compiled JavaScript output
├── node_modules/                 # Dependencies
├── package.json                  # Project configuration
├── tsconfig.json                 # TypeScript configuration
├── .env                          # Environment variables (create this)
└── README.md                     # This file
```

## Files & Folders Created

The server creates and manages several directories and files during operation:

### Cache Directory Structure
```
~/.hyperlane-mcp/                 # Main cache directory
├── chains/                       # Chain configurations
│   ├── {chainName}.yaml          # Chain metadata
│   ├── {chainName}.deploy.yaml   # Deployed contract addresses
│   └── {chainName}-core-config.yaml # Core deployment config
├── routes/                       # Warp route configurations
│   └── {symbol}-{hash}.yaml      # Warp route configs
├── agents/                       # Agent configurations
│   └── {chainName}-agent-config.json # Validator/relayer configs
└── logs/                         # Runtime data and logs
    ├── hyperlane_db_validator_{chain}/ # Validator database
    ├── hyperlane_db_relayer/     # Relayer database
    └── hyperlane-validator-signatures-{chain}/ # Validator signatures
```

### File Types Created

#### Chain Configuration Files
- **`{chainName}.yaml`**: Contains chain metadata (RPC URLs, chain ID, native token info)
- **`{chainName}.deploy.yaml`**: Deployed contract addresses (mailbox, ISM, hooks, etc.)
- **`{chainName}-core-config.yaml`**: Core deployment configuration

#### Warp Route Files
- **`{symbol}-{hash}.yaml`**: Warp route configuration for cross-chain asset transfers

#### Agent Configuration Files
- **`{chainName}-agent-config.json`**: Configuration for validators and relayers

#### Docker Volumes
- **Validator databases**: Persistent storage for validator state
- **Relayer databases**: Persistent storage for relayer state
- **Signature storage**: Validator checkpoint signatures

### Temporary Files
- **Docker containers**: Validator and relayer containers (managed automatically)
- **Log files**: Runtime logs from validators and relayers

## Examples

### 1. Deploy a New Chain

```
Deploy Hyperlane core contracts to a new blockchain called "mytestnet" with chain ID 12345, RPC URL "https://rpc.mytestnet.com", native token symbol "MTN", and token name "MyTestNet Token". This should be marked as a testnet.
```

### 2. Send Cross-Chain Message

```
Send a cross-chain message from Ethereum to Polygon. The recipient address should be 0x742d35Cc6634C0532925a3b8D4C9db96c4b4d8b6 and the message body should be "Hello from Ethereum!"
```

### 3. Deploy Warp Route

```
Deploy a warp route for asset transfers between Ethereum and Arbitrum chains. Use collateral token type for Ethereum and synthetic token type for Arbitrum.
```

### 4. Transfer Assets

```
Transfer assets using the USDC warp route from Ethereum to Arbitrum. Transfer 100 USDC to recipient address 0x742d35Cc6634C0532925a3b8D4C9db96c4b4d8b6. First, fetch the warp route configuration for USDC on these chains using the resources.
```

### 5. Run Infrastructure

```
Start a validator for the "mytestnet" chain that we deployed earlier.
```

```
Start a relayer to handle message delivery between Ethereum and mytestnet chains. Use "mytestnet" as the validator chain name.
```

### 6. Multi-Chain Asset Transfer

```
Transfer 50 USDC from Ethereum to Polygon, then from Polygon to Arbitrum, using the existing USDC warp routes. The final recipient should be 0x742d35Cc6634C0532925a3b8D4C9db96c4b4d8b6.
```

### 7. Check Warp Route Resources

```
Show me the available warp route configurations for USDC token across Ethereum and Polygon chains.
```

### 8. Deploy Custom Token Route

```
Deploy a new warp route for a custom token called "MyToken" (symbol: MTK) between three chains: Ethereum (collateral type), Polygon (synthetic type), and Arbitrum (synthetic type).
```

## Troubleshooting

### Common Issues

#### 1. Docker Permission Errors
```bash
# Add user to docker group (Linux)
sudo usermod -aG docker $USER
# Restart shell or logout/login
```

#### 2. Insufficient Gas Fees
- Ensure your wallet has sufficient native tokens for gas
- Check current gas prices on target networks

#### 3. RPC Connection Issues
- Verify RPC URLs are accessible
- Check for rate limiting on RPC providers
- Consider using multiple RPC endpoints

#### 4. Container Startup Failures
```bash
# Check Docker logs
docker logs <container_id>

# Verify Docker image availability
docker pull gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.4.0
```

### Debug Mode

Run with MCP Inspector for detailed debugging:

```bash
pnpm inspect
```

### Log Files

Check logs in the cache directory:
```bash
# Validator logs
tail -f ~/.hyperlane-mcp/logs/validator-{chain}.log

# Relayer logs  
tail -f ~/.hyperlane-mcp/logs/relayer.log
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Code Style

- Use TypeScript for all new code
- Follow existing code formatting (Prettier)
- Add JSDoc comments for public APIs
- Include error handling

## Authors

- [Suryansh](https://github.com/Suryansh-23)
- [Ruddy](https://github.com/Ansh1902396)

## License

This project is licensed under the ISC License.

## Disclaimer

_The software is provided as is. No guarantee, representation or warranty is being made, express or implied, as to the safety or correctness of the software. It has not been audited and as such there can be no assurance it will work as intended. Users may experience delays, failures, errors, omissions, loss of transmitted information or loss of funds. The creators are not liable for any of the foregoing. Users should proceed with caution and use at their own risk._
