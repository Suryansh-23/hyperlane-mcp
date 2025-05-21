import { TokenType, WarpRouteDeployConfigSchema } from '@hyperlane-xyz/sdk';
import { z } from 'zod';

const _RequiredMailboxSchema = z.record(
  z.object({
    mailbox: z.string(),
  })
);
const WarpRouteDeployConfigMailboxRequiredSchema =
  WarpRouteDeployConfigSchema.and(_RequiredMailboxSchema);
export type WarpRouteDeployConfigMailboxRequired = z.infer<
  typeof WarpRouteDeployConfigMailboxRequiredSchema
>;
const TYPE_DESCRIPTIONS: Record<TokenType, string> = {
  [TokenType.synthetic]: 'A new ERC20 with remote transfer functionality',
  [TokenType.syntheticRebase]: `A rebasing ERC20 with remote transfer functionality. Must be paired with ${TokenType.collateralVaultRebase}`,
  [TokenType.collateral]:
    'Extends an existing ERC20 with remote transfer functionality',
  [TokenType.native]:
    'Extends the native token with remote transfer functionality',
  [TokenType.collateralVault]:
    'Extends an existing ERC4626 with remote transfer functionality. Yields are manually claimed by owner.',
  [TokenType.collateralVaultRebase]:
    'Extends an existing ERC4626 with remote transfer functionality. Rebases yields to token holders.',
  [TokenType.collateralFiat]:
    'Extends an existing FiatToken with remote transfer functionality',
  [TokenType.XERC20]:
    'Extends an existing xERC20 with Warp Route functionality',
  [TokenType.XERC20Lockbox]:
    'Extends an existing xERC20 Lockbox with Warp Route functionality',
  // TODO: describe
  [TokenType.syntheticUri]: '',
  [TokenType.collateralUri]: '',
  [TokenType.nativeScaled]: '',
  [TokenType.fastSynthetic]: '',
  [TokenType.fastCollateral]: '',
};
export const TYPE_CHOICES = Object.values(TokenType).map((type) => ({
  name: type,
  value: type,
  description: TYPE_DESCRIPTIONS[type],
}));

export interface ChainConfig {
  chainName: string;
  chainId: string | number;
  rpcUrl: string;
  isTestnet: boolean;
  tokenSymbol?: string;
  tokenName?: string;
}

export interface ChainTokenConfig {
  tokenSymbol?: string;
  tokenName?: string;
}
