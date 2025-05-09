import {  ChainMetadata } from "@hyperlane-xyz/sdk";
import { ChainTokenConfig } from "./types.js";


export async function addNativeTokenConfig(
    metadata: ChainMetadata , 
    tokenConfig:  ChainTokenConfig,
    wantNativeTokenConfig : boolean
) {

    if (wantNativeTokenConfig) {
        const nativeTokenSymbol = tokenConfig.tokenSymbol
        const nativeTokenName = tokenConfig.tokenName
       
        metadata.nativeToken = {
            symbol: nativeTokenSymbol ?? "ETH",
            name: nativeTokenName ?? "Ether",
            decimals: 18,
        };
    }
}
