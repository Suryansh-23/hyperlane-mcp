import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { BaseRegistry } from '@hyperlane-xyz/registry';
import {
  ChainName,
  DispatchedMessage,
  HyperlaneCore,
  MultiProvider,
} from '@hyperlane-xyz/sdk';
import { addressToBytes32 } from '@hyperlane-xyz/utils';

export async function msgTransfer({
  origin,
  destination,
  recipient,
  messageBody,
  registry,
  multiProvider,
}: {
  origin: ChainName;
  destination: ChainName;
  recipient: string;
  messageBody: string;
  registry: BaseRegistry;
  multiProvider: MultiProvider;
  // log: (params: any) => Promise<void>;
}): Promise<[TransactionReceipt, DispatchedMessage]> {
  const updatedChainAddresses = {
    [origin]: (await registry.getAddresses())[origin],
    [destination]: (await registry.getAddresses())[destination],
  };

  const core = HyperlaneCore.fromAddressesMap(
    updatedChainAddresses,
    multiProvider
  );

  const formattedRecipient = addressToBytes32(recipient);
  const { dispatchTx, message } = await core.sendMessage(
    origin,
    destination,
    formattedRecipient,
    messageBody
  );

  return [dispatchTx, message];
}
