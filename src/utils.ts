import { ensure0x } from "@hyperlane-xyz/utils";
import { ethers } from "ethers";
import { HookConfig , IsmConfig , HookType , IsmType } from "@hyperlane-xyz/sdk";

export function privateKeyToSigner(key: string): ethers.Wallet {
  if (!key) throw new Error("No private key provided");

  const formattedKey = key.trim().toLowerCase();
  if (ethers.utils.isHexString(ensure0x(formattedKey)))
    return new ethers.Wallet(ensure0x(formattedKey));
  else if (formattedKey.split(" ").length >= 6)
    return ethers.Wallet.fromMnemonic(formattedKey);
  else throw new Error("Invalid private key format");
}

export function callWithConfigCreationLogs<T extends IsmConfig | HookConfig>(
  fn: (...args: any[]) => Promise<T>,
  type: IsmType | HookType
) {
  return async (...args: any[]): Promise<T> => {
      console.log(`Creating ${type}...`);
      try {
          const result = await fn(...args);
          return result;
      } finally {
          console.log(`Created ${type}!`);
      }
  };
}