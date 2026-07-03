import {
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";

export type MiniAppSelectedNetworkConfig = {
  network_name: string;
  network_placement_id: string;
  richads_publisher_id?: string;
  richads_app_id?: string;
};

export function prepareMiniAppAdClientConfig(config: MiniAppSelectedNetworkConfig) {
  if (!isMiniAppNetworkName(config.network_name)) {
    throw new Error("Unsupported Mini App ad network");
  }

  const normalized = buildMiniAppNetworkClientConfig(
    config.network_name as MiniAppNetworkName,
    config.network_placement_id,
    { publisherId: config.richads_publisher_id, appId: config.richads_app_id }
  );

  return {
    ...normalized,
    sdk_execution: "enabled",
    instructions: "Use requestMiniAppAd() from miniappSdkRuntime on the Mini App frontend. Successful displays must confirm through /api/miniapp/mediation/impression.",
  };
}
