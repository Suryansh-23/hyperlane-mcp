import { ChainName, HyperlaneCore, HyperlaneRelayer } from "@hyperlane-xyz/sdk";
import { timeout, addressToBytes32 } from "@hyperlane-xyz/utils";
import { MINIMUM_TEST_SEND_GAS } from "./consts.js";
import { WriteCommandContext, CommandContext } from "./context.js";
import { runPreflightChecksForChains, stubMerkleTreeConfig } from "./utils.js";

export async function msgTransfer({
  context,
  origin,
  destination,
  recipient,
  messageBody,
  timeoutSec,
  skipWaitForDelivery,
  selfRelay,
}: {
  context: WriteCommandContext;
  origin: ChainName;
  destination: ChainName;
  recipient: string;
  messageBody: string;
  timeoutSec: number;
  skipWaitForDelivery: boolean;
  selfRelay?: boolean;
}) {
  await runPreflightChecksForChains({
    context,
    chains: [origin, destination],
    chainsToGasCheck: [origin],
    minGas: MINIMUM_TEST_SEND_GAS,
  });

  await timeout(
    executeDelivery({
      context,
      origin,
      destination,
      recipient,
      messageBody,
      skipWaitForDelivery,
      selfRelay,
    }),
    timeoutSec * 1000,
    "Timed out waiting for messages to be delivered"
  );
}

async function executeDelivery({
  context,
  origin,
  destination,
  recipient,
  messageBody,
  skipWaitForDelivery,
  selfRelay,
}: {
  context: CommandContext;
  origin: ChainName;
  destination: ChainName;
  recipient: string;
  messageBody: string;
  skipWaitForDelivery: boolean;
  selfRelay?: boolean;
}) {
  const { registry, multiProvider } = context;
  const chainAddresses = await registry.getAddresses();
  const core = HyperlaneCore.fromAddressesMap(chainAddresses, multiProvider);

  try {
    if (!recipient) {
      throw new Error(`Unable to find TestRecipient for ${destination}`);
    }
    const formattedRecipient = addressToBytes32(recipient);

    // log("Dispatching message");
    const { dispatchTx, message } = await core.sendMessage(
      origin,
      destination,
      formattedRecipient,
      messageBody,
      // override the default hook (with IGP) for self-relay to avoid race condition with the production relayer
      selfRelay ? chainAddresses[origin].merkleTreeHook : undefined
    );
    // logBlue(
    //     `Sent message from ${origin} to ${recipient} on ${destination}.`
    // );
    // logBlue(`Message ID: ${message.id}`);
    // logBlue(`Explorer Link: ${EXPLORER_URL}/message/${message.id}`);
    // log(
    //     `Message:\n${indentYamlOrJson(yamlStringify(message, null, 2), 4)}`
    // );

    if (selfRelay) {
      const relayer = new HyperlaneRelayer({ core });

      const hookAddress = await core.getSenderHookAddress(message);
      const merkleAddress = chainAddresses[origin].merkleTreeHook;
      stubMerkleTreeConfig(relayer, origin, hookAddress, merkleAddress);

      // log("Attempting self-relay of message");
      await relayer.relayMessage(dispatchTx);
      // logGreen("Message was self-relayed!");
    } else {
      if (skipWaitForDelivery) {
        return;
      }

      // log("Waiting for message delivery on destination chain...");
      // Max wait 10 minutes
      await core.waitForMessageProcessed(dispatchTx, 10000, 60);
      // logGreen("Message was delivered!");
    }
  } catch (e) {
    // errorRed(
    //     `Encountered error sending message from ${origin} to ${destination}`
    // );
    throw e;
  }
}
