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
    logger.info(`Created directory: ${directoryPath}`);
  }
};

export interface ValidatorConfig {
  chainName: ChainName;
  validatorKey: string;
  configFilePath: string;
}

export class ValidatorRunner {
  private readonly chainName: ChainName;
  private readonly validatorKey: string;
  private readonly configFilePath: string;
  private readonly validatorSignaturesDir: string;
  private readonly validatorDbPath: string;
  private containerId: string | null = null;

  constructor(chainName: string, validatorKey: string, configFilePath: string) {
    this.chainName = chainName;
    this.validatorKey = validatorKey;
    this.configFilePath = configFilePath;
    this.validatorSignaturesDir = path.resolve(
      `${process.env.CACHE_DIR || process.env.HOME!}/.hyperlane-mcp/logs/tmp/hyperlane-validator-signatures-${chainName}`
    );
    this.validatorDbPath = path.resolve(`${process.env.CACHE_DIR || process.env.HOME!}/.hyperlane-mcp/logs/hyperlane_db_validator_${chainName}`);

    // Ensure required directories exist
    createDirectory(this.validatorSignaturesDir);
    createDirectory(this.validatorDbPath);

    logger.info(`Validator config: ${JSON.stringify(this, null, 2)}`);
  }

  async run(): Promise<void> {
    try {
      await this.pullDockerImage();
      await this.createAndStartContainer();
      await this.monitorLogs();
    } catch (error) {
      logger.error(
        `Error starting validator for chain: ${this.chainName} : ${error}`
      );
      throw error;
    }
  }

  private async pullDockerImage(): Promise<void> {
    logger.info(`Pulling latest Hyperlane agent Docker image...`);
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
              logger.info(`Downloading Docker image... ${JSON.stringify(event, null, 2)}`);
            }
          );
        }
      );
    });
  }

  private async createAndStartContainer(): Promise<void> {
    logger.info(
      `Creating container for validator on chain: ${this.chainName}...`
    );
    const container = await docker.createContainer({
      Image: 'gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0',
      Env: [`CONFIG_FILES=${this.configFilePath}`],
      HostConfig: {
        Mounts: [
          {
            Source: path.resolve(this.configFilePath),
            Target: path.join(process.env.CACHE_DIR || process.env.HOME!, '.hyperlane-mcp', 'agents', `${this.chainName}-agent-config.json`),
            Type: 'bind',
            ReadOnly: true,
          },
          {
            Source: this.validatorDbPath,
            Target: '/hyperlane_db',
            Type: 'bind',
          },
          {
            Source: this.validatorSignaturesDir,
            Target: '/tmp/validator-signatures',
            Type: 'bind',
          },
        ],
      },
      Cmd: [
        './validator',
        '--db',
        '/hyperlane_db',
        '--originChainName',
        this.chainName,
        '--checkpointSyncer.type',
        'localStorage',
        '--checkpointSyncer.path',
        '/tmp/validator-signatures',
        '--validator.key',
        this.validatorKey,
      ],
      Tty: true,
    });

    this.containerId = container.id;

    logger.info(`Starting validator for chain: ${this.chainName}...`);
    await container.start();
    logger.info(`Validator for chain: ${this.chainName} started successfully.`);
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

    logger.info('Validator is now running. Monitoring logs...');
  }

  async checkStatus(): Promise<void> {
    try {
      const containers = await docker.listContainers({ all: true });
      const runningContainer = containers.find(
        (c) => c.Id === this.containerId
      );
      if (runningContainer) {
        logger.info(`Validator container is running: ${runningContainer.Id}`);
      } else {
        logger.info('Validator container is not running.');
      }
    } catch (error) {
      logger.error(`Error checking container status: ${error}`);
      throw error;
    }
  }
}
