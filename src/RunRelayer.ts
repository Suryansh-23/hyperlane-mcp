import Docker from 'dockerode';
import path from 'path';
import fs from 'fs';
import { ChainName } from '@hyperlane-xyz/sdk';
import logger from './index.js';


const docker = new Docker();

// Utility to create directories if they don't exist
const createDirectory = (directoryPath: string): void => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
    console.log(`Created directory: ${directoryPath}`);
  }
};

export interface RelayerConfig {
  relayChains: ChainName[];
  relayerKey: string;
  configFilePath: string;
  validatorChainName: string;
}

export class RelayerRunner {
  private readonly relayChains: ChainName[];
  private readonly relayerKey: string;
  private readonly configFilePath: string;
  private readonly relayerDbPath: string;
  private readonly validatorSignaturesDir: string;
  private readonly validatorChainName: string;
  private containerId: string | null = null;

  constructor(
    relayChains: string[],
    relayerKey: string,
    configFilePath: string,
    validatorChainName: string
  ) {
    this.relayChains = relayChains;
    this.relayerKey = relayerKey;
    this.configFilePath = configFilePath;
    this.relayerDbPath = path.resolve(`${process.env.CACHE_DIR || process.env.HOME!}/.hyperlane-mcp/logs/hyperlane_db_relayer`);
    this.validatorSignaturesDir = path.resolve(
      `${process.env.CACHE_DIR || process.env.HOME!}/.hyperlane-mcp/logs/tmp/hyperlane-validator-signatures-${validatorChainName}`
    );
    this.validatorChainName = validatorChainName;

    // Ensure required directories exist
    createDirectory(this.relayerDbPath);
  }

  async run(): Promise<void> {
    try {
      await this.pullDockerImage();
      await this.createAndStartContainer();
      await this.monitorLogs();
    } catch (error) {
      logger.error(
        `Error starting relayer for chains: ${this.relayChains.join(', ')} : ${error}`
      );
      throw error;
    }
  }

  private async pullDockerImage(): Promise<void> {
    console.log(`Pulling latest Hyperlane agent Docker image...`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(
        'gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0',
        (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }
          docker.modem.followProgress(
            stream,
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            },
            (event: any) => {
              console.log('Downloading Docker image...', event);
            }
          );
        }
      );
    });
  }

  private async createAndStartContainer(): Promise<void> {
    logger.info(
      `Creating container for relayer on chains: ${this.relayChains.join(
        ', '
      )}...`
    );
    const container = await docker.createContainer({
      Image: 'gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0',
      Env: [`CONFIG_FILES=${this.configFilePath}`],
      HostConfig: {
        Mounts: [
          {
            Source: path.resolve(this.configFilePath),
            Target: path.join(process.env.CACHE_DIR || process.env.HOME!, '.hyperlane-mcp', 'agents', `${this.validatorChainName}-agent-config.json`),
            Type: 'bind',
            ReadOnly: true,
          },
          {
            Source: this.relayerDbPath,
            Target: '/hyperlane_db',
            Type: 'bind',
          },
          {
            Source: this.validatorSignaturesDir,
            Target: '/tmp/validator-signatures',
            Type: 'bind',
            ReadOnly: true,
          },
        ],
      },
      Cmd: [
        './relayer',
        '--db',
        '/hyperlane_db',
        '--relayChains',
        this.relayChains.join(','),
        '--allowLocalCheckpointSyncers',
        'true',
        '--defaultSigner.key',
        this.relayerKey,
      ],
      Tty: true,
    });

    this.containerId = container.id;

    logger.info(
      `Starting relayer for chains: ${this.relayChains.join(', ')}...`
    );
    await container.start();
    logger.info(
      `Relayer for chains: ${this.relayChains.join(', ')} started successfully.`
    );
  }

  private async monitorLogs(): Promise<void> {
    if (!this.containerId) {
      throw new Error('Container ID not set');
    }

    const container = docker.getContainer(this.containerId);
    logger.info('Fetching container logs...');
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });
    logStream.on('data', (chunk) => {
      logger.info(chunk.toString());
    });

    logger.info('Relayer is now running. Monitoring logs...');
  }

  async checkStatus(): Promise<void> {
    try {
      const containers = await docker.listContainers({ all: true });
      const runningContainer = containers.find(
        (c) => c.Id === this.containerId
      );
      if (runningContainer) {
        logger.info(`Relayer container is running: ${runningContainer.Id}`);
      } else {
        logger.info('Relayer container is not running.');
      }
    } catch (error) {
      logger.error(`Error checking container status: ${error}`);
      throw error;
    }
  }
}
