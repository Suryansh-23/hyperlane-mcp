import {
  ChainName,
  HookType,
  HyperlaneRelayer,
  MultiProvider,
} from "@hyperlane-xyz/sdk";
import { ensure0x, ProtocolType } from "@hyperlane-xyz/utils";
import { ethers } from "ethers";

import { IRegistry } from "@hyperlane-xyz/registry";

/**
 * Verifies the specified signer is valid.
 * @param signer the signer to verify
 */
function assertSigner(signer: ethers.Signer) {
  if (!signer || !ethers.Signer.isSigner(signer))
    throw new Error("Signer is invalid");
}

export function privateKeyToSigner(key: string): ethers.Wallet {
  if (!key) throw new Error("No private key provided");

  const formattedKey = key.trim().toLowerCase();
  if (ethers.utils.isHexString(ensure0x(formattedKey)))
    return new ethers.Wallet(ensure0x(formattedKey));
  else if (formattedKey.split(" ").length >= 6)
    return ethers.Wallet.fromMnemonic(formattedKey);
  else throw new Error("Invalid private key format");
}

async function getMultiProvider(registry: IRegistry, signer?: ethers.Signer) {
  const chainMetadata = await registry.getMetadata();
  const multiProvider = new MultiProvider(chainMetadata);
  if (signer) multiProvider.setSharedSigner(signer);
  return multiProvider;
}

export async function nativeBalancesAreSufficient(
  multiProvider: MultiProvider,
  chains: ChainName[],
  minGas: string,
  skipConfirmation: boolean
) {
  const sufficientBalances: boolean[] = [];
  for (const chain of chains) {
    // Only Ethereum chains are supported
    if (multiProvider.getProtocol(chain) !== ProtocolType.Ethereum) {
      // logGray(`Skipping balance check for non-EVM chain: ${chain}`);
      continue;
    }
    const address = multiProvider.getSigner(chain).getAddress();
    const provider = multiProvider.getProvider(chain);
    const gasPrice = await provider.getGasPrice();
    const minBalanceWei = gasPrice.mul(minGas).toString();
    const minBalance = ethers.utils.formatEther(minBalanceWei.toString());

    const balanceWei = await multiProvider
      .getProvider(chain)
      .getBalance(address);
    const balance = ethers.utils.formatEther(balanceWei.toString());
    if (balanceWei.lt(minBalanceWei)) {
      const symbol =
        multiProvider.getChainMetadata(chain).nativeToken?.symbol ?? "ETH";
      // logRed(
      //   `WARNING: ${address} has low balance on ${chain}. At least ${minBalance} ${symbol} recommended but found ${balance} ${symbol}`,
      // );
      sufficientBalances.push(false);
    }
  }
  const allSufficient = sufficientBalances.every((sufficient) => sufficient);

  if (allSufficient) {
    //   logGreen('✅ Balances are sufficient');
    return true;
  } else {
    return false;
  }
}

// export async function runPreflightChecksForChains({
//   context,
//   chains,
//   minGas,
//   chainsToGasCheck,
// }: {
//   context: WriteCommandContext;
//   chains: ChainName[];
//   minGas: string;
//   // Chains for which to assert a native balance
//   // Defaults to all chains if not specified
//   chainsToGasCheck?: ChainName[];
// }) {
//   // log('Running pre-flight checks for chains...');
//   const { multiProvider, skipConfirmation } = context;

//   if (!chains?.length) throw new Error("Empty chain selection");
//   for (const chain of chains) {
//     const metadata = multiProvider.tryGetChainMetadata(chain);
//     if (!metadata) throw new Error(`No chain config found for ${chain}`);
//     if (metadata.protocol !== ProtocolType.Ethereum)
//       throw new Error("Only Ethereum chains are supported for now");
//     const signer = multiProvider.getSigner(chain);
//     assertSigner(signer);
//     //   logGreen(`✅ ${metadata.displayName ?? chain} signer is valid`);
//   }
//   // logGreen('✅ Chains are valid');

//   await nativeBalancesAreSufficient(
//     multiProvider,
//     chainsToGasCheck ?? chains,
//     minGas,
//     skipConfirmation
//   );
// }

export function stubMerkleTreeConfig(
  relayer: HyperlaneRelayer,
  chain: string,
  hookAddress: string,
  merkleAddress: string
) {
  relayer.hydrate({
    hook: {
      [chain]: {
        [hookAddress]: {
          type: HookType.MERKLE_TREE,
          address: merkleAddress,
        },
      },
    },
    ism: {},
    backlog: [],
  });
}
