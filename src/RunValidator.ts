import Docker from "dockerode";
import path from "path";
import fs from "fs";

const docker = new Docker();

// Utility to create directories if they don't exist
const createDirectory = (directoryPath: string): void => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
    console.log(`Created directory: ${directoryPath}`);
  }
};

// Class for running a Validator
export class ValidatorRunner {
  private chainName: string;
  private validatorKey: string;
  private configFilePath: string;
  private validatorSignaturesDir: string;
  private validatorDbPath: string;
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
      console.log(`Pulling latest Hyperlane agent Docker image...`);
      await docker.pull("gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0", (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          console.error("Error pulling Docker image:", err);
          return;
        }
        docker.modem.followProgress(stream, onFinished, onProgress);

        function onFinished(err: Error | null, result: any[]) {
          if (err) {
            console.error("Error pulling Docker image:", err);
          } else {
            console.log("Docker image pulled successfully.");
          }
        }

        function onProgress(event: any) {
          console.log("Downloading Docker image...", event);
        }
      });

      console.log(`Creating container for validator on chain: ${this.chainName}...`);
      const container = await docker.createContainer({
        Image: "gcr.io/abacus-labs-dev/hyperlane-agent:agents-v1.1.0",
        Env: [`CONFIG_FILES=/home/ruddy/Hyperlane-ChainDeployer/hyperlane-deployer/configs/agent-config.json`],
        HostConfig: {
          Mounts: [
            {
              Source: path.resolve(this.configFilePath),
              Target: "/home/ruddy/Hyperlane-ChainDeployer/hyperlane-deployer/configs/agent-config.json",
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
    } catch (error) {
      console.error(`Error starting validator for chain: ${this.chainName}`, error);
    }
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
    }
  }
}