import {
  ChainMetadata,
  MultisigIsmConfig,
  IsmConfig,
  MultisigIsmConfigSchema,
  HookConfig,
  HookType,
} from "@hyperlane-xyz/sdk";
import { callWithConfigCreationLogs } from "./utils.js";
import { ChainTokenConfig } from "./types.js";

export async function addNativeTokenConfig(
  metadata: ChainMetadata,
  tokenConfig: ChainTokenConfig
) {
  const nativeTokenSymbol = tokenConfig.tokenSymbol;
  const nativeTokenName = tokenConfig.tokenName;

  metadata.nativeToken = {
    symbol: nativeTokenSymbol ?? "ETH",
    name: nativeTokenName ?? "Ether",
    decimals: 18,
  };
}

export async function createMultisignConfig(
  ismType: MultisigIsmConfig["type"]
): Promise<IsmConfig> {
  const validators: string[] = [];
  const threshold = 1;

  const result = MultisigIsmConfigSchema.safeParse({
    type: ismType,
    validators,
    threshold,
  });

  if (!result.success) {
    return createMultisignConfig(ismType);
  }
  return result.data;
}

export const createMerkleTreeConfig = callWithConfigCreationLogs(
  async (): Promise<HookConfig> => {
    return { type: HookType.MERKLE_TREE };
  },
  HookType.MERKLE_TREE
);
