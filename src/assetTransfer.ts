import { BaseRegistry } from "@hyperlane-xyz/registry";
import {
  ChainName,
  DispatchedMessage,
  HyperlaneCore,
  MultiProtocolProvider,
  MultiProvider,
  ProviderType,
  Token,
  TokenAmount,
  WarpCore,
  WarpCoreConfig,
} from "@hyperlane-xyz/sdk";
import { parseWarpRouteMessage, timeout } from "@hyperlane-xyz/utils";
import { ContractReceipt } from "ethers";

export async function assetTransfer({
  warpCoreConfig,
  chains,
  amount,
  recipient,
  multiProvider,
}: {
  warpCoreConfig: WarpCoreConfig;
  chains: ChainName[];
  amount: string;
  recipient?: string;
  multiProvider: MultiProvider;
}): Promise<[ContractReceipt, DispatchedMessage][]> {
  const results: [ContractReceipt, DispatchedMessage][] = [];
  for (let i = 0; i < chains.length; i++) {
    const origin = chains[i];
    const destination = chains[i + 1];

    if (destination) {
      const deliveryResult = await timeout(
        executeDelivery({
          origin,
          destination,
          warpCoreConfig,
          amount,
          recipient,
          multiProvider,
        }),
        120_000,
        "Timed out waiting for messages to be delivered"
      );

      if (deliveryResult) {
        const [dispatchTx, message] = deliveryResult;
        results.push([dispatchTx, message]);
      } else {
        break;
      }
    }
  }
  return results;
}

async function executeDelivery({
  origin,
  destination,
  warpCoreConfig,
  amount,
  recipient,
  multiProvider,
}: {
  origin: ChainName;
  destination: ChainName;
  warpCoreConfig: WarpCoreConfig;
  amount: string;
  recipient?: string;
  multiProvider: MultiProvider;
}): Promise<[ContractReceipt, DispatchedMessage]> {
  const signer = multiProvider.getSigner(origin);
  const recipientSigner = multiProvider.getSigner(destination);

  const recipientAddress = await recipientSigner.getAddress();
  const signerAddress = await signer.getAddress();

  recipient ||= recipientAddress;

  const provider = multiProvider.getProvider(origin);
  const connectedSigner = signer.connect(provider);

  const warpCore = WarpCore.FromConfig(
    MultiProtocolProvider.fromMultiProvider(multiProvider),
    warpCoreConfig
  );

  let token: Token;
  const tokensForRoute = warpCore.getTokensForRoute(origin, destination);
  if (tokensForRoute.length === 0) {
    // console.error(`No Warp Routes found from ${origin} to ${destination}`);
    throw new Error("Error finding warp route");
  } else if (tokensForRoute.length === 1) {
    token = tokensForRoute[0];
  } else {
    // console.info(`Please select a token from the Warp config`);
    // const routerAddress = await runTokenSelectionStep(tokensForRoute);
    // token = warpCore.findToken(origin, routerAddress)!;
    throw new Error("Multiple tokens found for route");
  }

  const errors = await warpCore.validateTransfer({
    originTokenAmount: token.amount(amount),
    destination,
    recipient,
    sender: signerAddress,
  });
  if (errors) {
    console.error("Error validating transfer: ", JSON.stringify(errors));
  }

  // TODO: override hook address for self-relay
  const transferTxs = await warpCore.getTransferRemoteTxs({
    originTokenAmount: new TokenAmount(amount, token),
    destination,
    sender: signerAddress,
    recipient,
  });

  const txReceipts: ContractReceipt[] = [];
  for (const tx of transferTxs) {
    if (tx.type === ProviderType.EthersV5) {
      const txResponse = await connectedSigner.sendTransaction(tx.transaction);
      const txReceipt = await multiProvider.handleTx(origin, txResponse);
      txReceipts.push(txReceipt);
    }
  }
  const dispatchTx = txReceipts[txReceipts.length - 1];
  const messageIndex: number = 0;
  const message: DispatchedMessage =
    HyperlaneCore.getDispatchedMessages(dispatchTx)[messageIndex];

  const parsed = parseWarpRouteMessage(message.parsed.body);

  return [dispatchTx, message];
}
