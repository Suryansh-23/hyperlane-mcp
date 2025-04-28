import { IRegistry } from "@hyperlane-xyz/registry";
import { WarpCoreConfig } from "@hyperlane-xyz/sdk";

export async function selectRegistryWarpRoute(
  registry: IRegistry,
  symbol: string,
  chainName: string
): Promise<WarpCoreConfig> {
  const matching = await registry.getWarpRoutes({
    symbol,
    chainName,
  });
  const routes = Object.entries(matching);
  console.log(routes);

  let warpCoreConfig: WarpCoreConfig;
  if (routes.length === 0) {
    throw new Error(`No warp routes found for symbol ${symbol}`);
  } else if (routes.length === 1) {
    warpCoreConfig = routes[0][1];
  } else {
    console.log(`Multiple warp routes found for symbol ${symbol}`);
    warpCoreConfig = routes[0][1];
    //   const chosenRouteId = await select({
    //     message: 'Select from matching warp routes',
    //     choices: routes.map(([routeId, _]) => ({
    //       value: routeId,
    //     })),
    //   });
    //   warpCoreConfig = matching[chosenRouteId];
  }
  console.log(routes[0][1]);

  return warpCoreConfig;
}

export async function getChains(registry: IRegistry): Promise<string[]> {
  return await registry.getChains();
}

export async function getWarpRoutes(registry: IRegistry): Promise<string[]> {
  const routes = await registry.getWarpRoutes();
  return Object.keys(routes);
}

export async function getChainAndTokenPairs(
  registry: IRegistry
): Promise<{ chain: string; symbol: string; routeId: string }[]> {
  const routes = await registry.getWarpRoutes();
  return Object.entries(routes)
    .map(([routeId, config]) => {
      return config.tokens.map((token) => ({
        chain: token.chainName,
        symbol: token.symbol,
        routeId,
      }));
    })
    .flat();
}

export async function checkIfAllEachWarpRouteHasSameTokenForChains(
  registry: IRegistry
) {
  const routes = await registry.getWarpRoutes();
  for (const route of Object.values(routes)) {
    const sym = route.tokens[0].symbol;
    for (const token of route.tokens) {
      if (token.symbol !== sym) {
        console.error(
          `Warp route ${route} has different tokens for chains ${token.chainName}`,
          route.tokens
        );
      }
    }
  }
}

export async function getWarpRoutesBySymbol(
  registry: IRegistry,
  symbol: string
): Promise<string[]> {
  const routes = await registry.getWarpRoutes({
    symbol,
  });
  return Object.keys(routes);
}

export async function getWarpRoutesByChains(
  registry: IRegistry,
  chainNames: string[]
): Promise<string[]> {
  const routes = await registry.getWarpRoutes();
  return Object.entries(routes)
    .map(([routeId, config]) => {
      const chains = new Set(chainNames);
      config.tokens.forEach((token) => {
        chains.delete(token.chainName);
      });

      if (chains.size === 0) {
        return routeId;
      }
    })
    .filter((routeId) => routeId !== undefined);
}

export async function getWarpRoutesBySymbolAndChain(
  registry: IRegistry,
  symbol: string,
  chainName: string
): Promise<string[]> {
  const routes = await registry.getWarpRoutes({
    symbol,
    chainName,
  });
  return Object.keys(routes);
}

export async function getWarpRoutesBySymbolAndChains(
  registry: IRegistry,
  symbol: string,
  chainNames: string[]
): Promise<string[]> {
  const routes = await registry.getWarpRoutes({
    symbol,
  });

  return Object.entries(routes)
    .map(([routeId, config]) => {
      const chains = new Set(chainNames);
      config.tokens.forEach((token) => {
        chains.delete(token.chainName);
      });

      if (chains.size === 0) {
        return routeId;
      }
    })
    .filter((routeId) => routeId !== undefined);
}
