import {
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";

export type MiniAppSelectedNetworkConfig = {
  network_name: string;
  network_placement_id: string;
};

export function prepareMiniAppAdClientConfig(config: MiniAppSelectedNetworkConfig) {
  if (!isMiniAppNetworkName(config.network_name)) {
    throw new Error("Unsupported Mini App ad network");
  }

  const normalized = buildMiniAppNetworkClientConfig(
    config.network_name as MiniAppNetworkName,
    config.network_placement_id
  );

  return {
    ...normalized,
    sdk_execution: "enabled",
    instructions: "Use requestMiniAppAd() from miniappSdkRuntime on the Mini App frontend. Successful displays must confirm through /api/miniapp/mediation/impression.",
  };
}
