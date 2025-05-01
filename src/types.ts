import { WarpRouteDeployConfigSchema } from "@hyperlane-xyz/sdk";
import { z } from "zod";

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
