import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  MINIAPP_NETWORKS,
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";
import { getDisabledMiniappNetworks, requireAdServingAllowed } from "@/lib/productionSafety";
import { requireMiniappTrackingUser } from "@/lib/publicSdkAuth";

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  richads_publisher_id: string | null;
  richads_app_id: string | null;
};

export async function GET(request: Request) {
  try {
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    const { searchParams } = new URL(request.url);
    const miniappId = Number(searchParams.get("miniapp_id"));
    const requestedNetwork = searchParams.get("network_name")?.trim();

    if (!Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ error: "Valid miniapp_id is required" }, { status: 400 });
    }

    await requireMiniappTrackingUser(request, miniappId);

    if (requestedNetwork && !isMiniAppNetworkName(requestedNetwork)) {
      return NextResponse.json({ error: "Invalid network_name" }, { status: 400 });
    }

    const [miniapps] = await pool.query<MiniAppRow[]>(
      "SELECT id, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [miniappId]
    );

    if (miniapps.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    if (miniapps[0].status !== "approved" && miniapps[0].status !== "monetized") {
      return NextResponse.json({ error: "Mini App is not approved for mediation config" }, { status: 403 });
    }

    const params: Array<number | string | string[]> = [miniappId, [...MINIAPP_NETWORKS]];
    let networkFilter = "";

    if (requestedNetwork) {
      networkFilter = " AND network_name = ?";
      params.push(requestedNetwork);
    }

    const [networkRows] = await pool.query<NetworkRow[]>(`
      SELECT network_name, network_placement_id, richads_publisher_id, richads_app_id
      FROM miniapp_ad_networks
      WHERE miniapp_id = ?
        AND enabled = TRUE
        AND network_name IN (?)
        ${networkFilter}
      ORDER BY COALESCE(NULLIF(priority_order, 0), FIELD(network_name, 'AdsGalaxyInternal', 'AdsGram', 'GigaPub', 'AdExium', 'Monetag', 'RichAds')),
        FIELD(network_name, 'AdsGalaxyInternal', 'AdsGram', 'GigaPub', 'AdExium', 'Monetag', 'RichAds')
    `, params);

    const globallyDisabledNetworks = await getDisabledMiniappNetworks();
    const enabledNetworks = networkRows
      .filter((row) => isMiniAppNetworkName(row.network_name) && row.network_name !== "AdsGalaxyInternal")
      .filter((row) => !globallyDisabledNetworks.has(row.network_name))
      .map((row) => {
        try {
          return buildMiniAppNetworkClientConfig(row.network_name as MiniAppNetworkName, row.network_placement_id || "", {
            publisherId: row.richads_publisher_id,
            appId: row.richads_app_id,
          });
        } catch {
          return null;
        }
      })
      .filter((network): network is NonNullable<typeof network> => Boolean(network));

    if (requestedNetwork && enabledNetworks.length === 0) {
      return NextResponse.json({ error: "Requested network is disabled or missing required placement ID" }, { status: 400 });
    }

    return NextResponse.json({
      miniapp_id: miniappId,
      enabled_networks: enabledNetworks.map((network) => network.network_name),
      networks: enabledNetworks,
    });
  } catch (error) {
    console.error("Mini App mediation config failed", error);
    return NextResponse.json({ error: "Unable to load this advertisement. Please try again." }, { status: 500 });
  }
}
