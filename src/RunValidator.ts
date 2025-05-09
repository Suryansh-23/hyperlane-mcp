import Docker from "dockerode";
import path from "path";
import fs from "fs";
import { ChainName } from "@hyperlane-xyz/sdk";

const docker = new Docker();

// Utility to create directories if they don't exist
const createDirectory = (directoryPath: string): void => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
    console.log(`Created directory: ${directoryPath}`);
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
      `tmp/hyperlane-validator-signatures-${chainName}`
    );
    this.validatorDbPath = path.resolve(`hyperlane_db_validator_${chainName}`);

    // Ensure required directories exist
    createDirectory(this.validatorSignaturesDir);
    createDirectory(this.validatorDbPath);
  }

  async run(): Promise<void> {
    try {
      await this.pullDockerImage();
      await this.createAndStartContainer();
      await this.monitorLogs();
    } catch (error) {
      console.error(`Error starting validator for chain: ${this.chainName}`, error);
      throw error;
    }
  }

  private async pullDockerImage(): Promise<void> {
    console.log(`Pulling latest Hyperlane agent Docker image...`);
    await new Promise<void>((resolve, reject) => {
      docker.pull("gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0", (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }
        docker.modem.followProgress(stream, 
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
          (event: any) => {
            console.log("Downloading Docker image...", event);
          }
        );
      });
    });
  }

  private async createAndStartContainer(): Promise<void> {
    console.log(`Creating container for validator on chain: ${this.chainName}...`);
    const container = await docker.createContainer({
      Image: "gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0",
      Env: [`CONFIG_FILES=/config/agent-config.json`],
      HostConfig: {
        Mounts: [
          {
            Source: path.resolve(this.configFilePath),
            Target: "/config/agent-config.json",
            Type: "bind",
            ReadOnly: true,
          },
          {
            Source: this.validatorDbPath,
            Target: "/hyperlane_db",
            Type: "bind",
          },
          {
            Source: this.validatorSignaturesDir,
            Target: "/tmp/validator-signatures",
            Type: "bind",
          },
        ],
      },
      Cmd: [
        "./validator",
        "--db",
        "/hyperlane_db",
        "--originChainName",
        this.chainName,
        "--checkpointSyncer.type",
        "localStorage",
        "--checkpointSyncer.path",
        "/tmp/validator-signatures",
        "--validator.key",
        this.validatorKey,
      ],
      Tty: true,
    });

    this.containerId = container.id;

    console.log(`Starting validator for chain: ${this.chainName}...`);
    await container.start();
    console.log(`Validator for chain: ${this.chainName} started successfully.`);
  }

  private async monitorLogs(): Promise<void> {
    if (!this.containerId) {
      throw new Error("Container ID not set");
    }

    const container = docker.getContainer(this.containerId);
    console.log("Fetching container logs...");
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });
    logStream.on("data", (chunk) => {
      console.log(chunk.toString());
    });

    console.log("Validator is now running. Monitoring logs...");
  }

  async checkStatus(): Promise<void> {
    try {
      const containers = await docker.listContainers({ all: true });
      const runningContainer = containers.find((c) => c.Id === this.containerId);
      if (runningContainer) {
        console.log(`Validator container is running: ${runningContainer.Id}`);
      } else {
        console.log("Validator container is not running.");
      }
    } catch (error) {
      console.error("Error checking container status:", error);
      throw error;
    }
  }
}