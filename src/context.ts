import type { ethers } from "ethers";
import type { CommandModule } from "yargs";

import type { IRegistry } from "@hyperlane-xyz/registry";
import type { MultiProvider, WarpCoreConfig } from "@hyperlane-xyz/sdk";

export interface CommandContext {
  registry: IRegistry;
  multiProvider: MultiProvider;
  skipConfirmation: boolean;
  key?: string;
  // just for evm chains backward compatibility
  signerAddress?: string;
  // warpCoreConfig?: WarpCoreConfig;
  strategyPath?: string;
}

export interface WriteCommandContext extends CommandContext {
  key: string;
  signer: ethers.Signer;
  isDryRun?: boolean;
  dryRunChain?: string;
}

export type CommandModuleWithContext<Args> = CommandModule<
  {},
  Args & { context: CommandContext }
>;

export type CommandModuleWithWriteContext<Args> = CommandModule<
  {},
  Args & { context: WriteCommandContext }
>;
