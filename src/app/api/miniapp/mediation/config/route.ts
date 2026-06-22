import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  MINIAPP_NETWORKS,
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";
import { assertMiniAppOwnerBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const miniappId = Number(searchParams.get("miniapp_id"));
    const requestedNetwork = searchParams.get("network_name")?.trim();

    if (!Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ error: "Valid miniapp_id is required" }, { status: 400 });
    }

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

    await assertMiniAppOwnerBetaAccess(miniappId);

    const params: Array<number | string | string[]> = [miniappId, [...MINIAPP_NETWORKS]];
    let networkFilter = "";

    if (requestedNetwork) {
      networkFilter = " AND network_name = ?";
      params.push(requestedNetwork);
    }

    const [networkRows] = await pool.query<NetworkRow[]>(`
      SELECT network_name, network_placement_id
      FROM miniapp_ad_networks
      WHERE miniapp_id = ?
        AND enabled = TRUE
        AND network_name IN (?)
        ${networkFilter}
      ORDER BY COALESCE(NULLIF(priority_order, 0), FIELD(network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds')),
        FIELD(network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds')
    `, params);

    const enabledNetworks = networkRows
      .filter((row) => isMiniAppNetworkName(row.network_name))
      .map((row) => {
        try {
          return buildMiniAppNetworkClientConfig(row.network_name as MiniAppNetworkName, row.network_placement_id || "");
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
  } catch (error: any) {
    const status = error instanceof MiniAppBetaAccessError ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to load Mini App mediation config" }, { status });
  }
}
