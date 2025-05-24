import { ChainName } from '@hyperlane-xyz/sdk';
import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { fetchImageTags, getLatestImageTag } from './gcr.js';
import logger from './logger.js';
import { createDirectory } from './utils.js';

const docker = new Docker();
export interface ValidatorConfig {
  chainName: ChainName;
  validatorKey: string;
  configFilePath: string;
}

const DEFAULT_VALIDATOR_TAG = 'agents-v1.4.0';

export class ValidatorRunner {
  private readonly chainName: ChainName;
  private readonly validatorKey: string;
  private readonly configFilePath: string;
  private readonly validatorSignaturesDir: string;
  private readonly validatorDbPath: string;
  private containerId: string | null = null;
  private latestTag: string | null = DEFAULT_VALIDATOR_TAG;

  constructor(chainName: string, validatorKey: string, configFilePath: string) {
    this.chainName = chainName;
    this.validatorKey = validatorKey;
    this.configFilePath = configFilePath;

    const logsPath = path.join(
      process.env.CACHE_DIR || process.env.HOME!,
      '.hyperlane-mcp/logs'
    );
    createDirectory(logsPath);

    this.validatorSignaturesDir = path.resolve(
      `${logsPath}/hyperlane-validator-signatures-${chainName}`
    );
    this.validatorDbPath = path.resolve(
      `${logsPath}/hyperlane_db_validator_${chainName}`
    );

    // Ensure required directories exist
    createDirectory(this.validatorSignaturesDir);
    createDirectory(this.validatorDbPath);

    logger.info(`Validator config: ${JSON.stringify(this, null, 2)}`);
  }

  private async initializeLatestTag(): Promise<void> {
    if (this.latestTag !== DEFAULT_VALIDATOR_TAG) {
      return;
    }

    logger.info(`Initializing latest Docker image tag for validator...`);
    this.latestTag =
      getLatestImageTag(await fetchImageTags()) || DEFAULT_VALIDATOR_TAG;
    logger.info(`Latest Docker image tag in validator: ${this.latestTag}`);
  }

  async run(): Promise<void> {
    try {
      await this.initializeLatestTag();
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
        `gcr.io/abacus-labs-dev/hyperlane-agent:${this.latestTag}`,
        {
          platform: 'linux/x86_64/v8',
        },
        (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
          if (err) {
            reject(err);
            return;
          }
          if (!stream) {
            reject(new Error('Stream is undefined'));
            return;
          }
          docker.modem.followProgress(
            stream,
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            },
            (event: any) => {
              logger.info(
                `Downloading Docker image... ${JSON.stringify(event, null, 2)}`
              );
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
      Image: `gcr.io/abacus-labs-dev/hyperlane-agent:${this.latestTag}`,
      Env: [`CONFIG_FILES=${this.configFilePath}`],
      HostConfig: {
        NetworkMode: 'host',
        Mounts: [
          {
            Source: path.resolve(this.configFilePath),
            Target: path.join(
              process.env.CACHE_DIR || process.env.HOME!,
              '.hyperlane-mcp',
              'agents',
              `${this.chainName}-agent-config.json`
            ),
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
      NetworkDisabled: false,
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
