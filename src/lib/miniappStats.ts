import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { MINIAPP_NETWORKS, isMiniAppNetworkName } from "@/lib/miniappNetworkAdapters";
import { validateMiniappRevenue } from "@/lib/miniappRevenueValidation";
import { calculateDynamicPublisherEconomics, fraudValueFactor, getMiniAppPublisherCpmSettings, trustValueFactor } from "@/lib/miniappPublisherCpmEngine";

export { MINIAPP_NETWORKS, isMiniAppNetworkName };
export type { MiniAppNetworkName } from "@/lib/miniappNetworkAdapters";

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

type NetworkRow = RowDataPacket & {
  enabled: number | boolean;
};

type SettingRow = RowDataPacket & {
  value: string;
};

export type MiniAppStatInput = {
  miniapp_id: number;
  network_name: string;
  impressions: number;
  gross_revenue: number;
  country?: string;
  date?: string;
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value?: string) {
  const date = value || todayDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must use YYYY-MM-DD format");
  }
  return date;
}

function normalizeCountry(value?: string) {
  if (!value) return null;
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Country must be a 2-letter country code");
  }
  return country;
}

export async function getMiniAppFeePercent() {
  const [rows] = await pool.query<SettingRow[]>(
    "SELECT value FROM settings WHERE `key` = 'miniapp_ads_galaxy_fee_percent' LIMIT 1"
  );

  const feePercent = Number.parseFloat(rows[0]?.value || "15");
  if (!Number.isFinite(feePercent) || feePercent < 0) return 15;
  return feePercent;
}

export async function recordMiniAppStats(input: MiniAppStatInput) {
  if (!isMiniAppNetworkName(input.network_name)) {
    throw new Error("Invalid Mini App network");
  }

  const impressions = Number(input.impressions);
  const grossRevenue = Number(input.gross_revenue);

  if (!Number.isFinite(impressions) || impressions < 0) {
    throw new Error("Impressions must be greater than or equal to 0");
  }

  if (!Number.isFinite(grossRevenue) || grossRevenue < 0) {
    throw new Error("Gross revenue must be greater than or equal to 0");
  }

  const wholeImpressions = Math.floor(impressions);
  const date = normalizeDate(input.date);
  const country = normalizeCountry(input.country);

  const [miniapps] = await pool.query<MiniAppRow[]>(
    "SELECT id, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
    [input.miniapp_id]
  );

  if (miniapps.length === 0) {
    throw new Error("Mini App not found");
  }

  if (miniapps[0].status !== "approved" && miniapps[0].status !== "monetized") {
    throw new Error("Mini App must be approved before stats can be recorded");
  }

  if (input.network_name !== "AdsGalaxyInternal") {
    const [networks] = await pool.query<NetworkRow[]>(
      "SELECT enabled FROM miniapp_ad_networks WHERE miniapp_id = ? AND network_name = ? LIMIT 1",
      [input.miniapp_id, input.network_name]
    );

    if (networks.length === 0 || !Boolean(networks[0].enabled)) {
      throw new Error("Network is not enabled for this Mini App");
    }
  }

  const feePercent = await getMiniAppFeePercent();
  const conn = await pool.getConnection();
  let validation;
  let economics;
  try {
    validation = await validateMiniappRevenue({
      conn,
      networkName: input.network_name,
      impressions: wholeImpressions,
      grossRevenue,
    });
    const settings=await getMiniAppPublisherCpmSettings(conn);
    const [[signals]]=await conn.query<Array<RowDataPacket&{publisher_trust_score:number|string|null;publisher_risk_score:number|string|null;traffic_quality_score:number|string|null;traffic_risk_level:string|null}>>(`SELECT COALESCE(u.publisher_trust_score,60) publisher_trust_score,COALESCE(u.publisher_risk_score,0) publisher_risk_score,COALESCE(m.traffic_quality_score,50) traffic_quality_score,COALESCE(m.traffic_risk_level,'low') traffic_risk_level FROM miniapps m JOIN users u ON u.id=m.user_id WHERE m.id=? LIMIT 1`,[input.miniapp_id]);
    const risk=Math.max(Number(signals?.publisher_risk_score||0),signals?.traffic_risk_level==="critical"?100:signals?.traffic_risk_level==="high"?80:0);
    economics=calculateDynamicPublisherEconomics({economicValue:grossRevenue,impressionCount:wholeImpressions,country,demandYieldFactor:1,uniquenessFactor:.8,frequencyFactor:1,qualityFactor:Math.max(0,Math.min(1,Number(signals?.traffic_quality_score||50)/100)),trustFactor:trustValueFactor(Number(signals?.publisher_trust_score||60),settings),fraudFactor:fraudValueFactor(risk,false,settings)},settings);
  } finally {
    conn.release();
  }
  if (validation.status === "rejected") {
    throw new Error(`Revenue validation failed: ${validation.reason}`);
  }

  const adsGalaxyFee = economics?.platform_retained ?? grossRevenue * feePercent / 100;
  const reserveRevenue = economics?.reserve ?? 0;
  const publisherRevenue = economics?.publisher_payout ?? grossRevenue - adsGalaxyFee;
  const grossCpm = wholeImpressions > 0 ? (grossRevenue / wholeImpressions) * 1000 : 0;
  const netCpm = wholeImpressions > 0 ? (publisherRevenue / wholeImpressions) * 1000 : 0;

  await pool.query(
    `INSERT INTO miniapp_daily_stats
      (miniapp_id, network_name, date, impressions, gross_revenue, ads_galaxy_fee, reserve_revenue, publisher_revenue, gross_cpm, net_cpm,
       revenue_validation_status, revenue_validation_reason, revenue_validation_metadata, revenue_validated_at, revenue_review_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
      gross_cpm = CASE
        WHEN (impressions + VALUES(impressions)) > 0
          THEN ((gross_revenue + VALUES(gross_revenue)) / (impressions + VALUES(impressions))) * 1000
        ELSE 0
      END,
      net_cpm = CASE
        WHEN (impressions + VALUES(impressions)) > 0
          THEN ((publisher_revenue + VALUES(publisher_revenue)) / (impressions + VALUES(impressions))) * 1000
        ELSE 0
      END,
      impressions = impressions + VALUES(impressions),
      gross_revenue = gross_revenue + VALUES(gross_revenue),
      ads_galaxy_fee = ads_galaxy_fee + VALUES(ads_galaxy_fee),
      reserve_revenue = reserve_revenue + VALUES(reserve_revenue),
      publisher_revenue = publisher_revenue + VALUES(publisher_revenue),
      revenue_validation_status = CASE
        WHEN revenue_validation_status = 'rejected' OR VALUES(revenue_validation_status) = 'rejected' THEN 'rejected'
        WHEN revenue_validation_status = 'suspicious' OR VALUES(revenue_validation_status) = 'suspicious' THEN 'suspicious'
        ELSE 'passed'
      END,
      revenue_validation_reason = VALUES(revenue_validation_reason),
      revenue_validation_metadata = VALUES(revenue_validation_metadata),
      revenue_validated_at = NOW(),
      revenue_review_status = CASE
        WHEN VALUES(revenue_validation_status) = 'suspicious' AND revenue_review_status = 'not_required' THEN 'pending_review'
        WHEN VALUES(revenue_validation_status) = 'passed' AND revenue_review_status = 'pending_review' THEN 'not_required'
        ELSE revenue_review_status
      END`,
    [
      input.miniapp_id,
      input.network_name,
      date,
      wholeImpressions,
      grossRevenue,
      adsGalaxyFee,
      reserveRevenue,
      publisherRevenue,
      grossCpm,
      netCpm,
      validation.status,
      validation.reason,
      JSON.stringify({ ...validation.metadata, formula_version:economics?.formula_version||null, economic_value:grossRevenue, publisher_cap:economics?.publisher_cap||0, factors:economics?.factors||null }),
      validation.status === "suspicious" ? "pending_review" : "not_required",
    ]
  );

  if (country) {
    await pool.query(
      `INSERT INTO miniapp_country_stats (miniapp_id, network_name, country, date, impressions)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE impressions = impressions + VALUES(impressions)`,
      [input.miniapp_id, input.network_name, country, date, wholeImpressions]
    );
  }

  return {
    miniapp_id: input.miniapp_id,
    network_name: input.network_name,
    date,
    country,
    impressions: wholeImpressions,
    gross_revenue: grossRevenue,
    ads_galaxy_fee: adsGalaxyFee,
    reserve_revenue: reserveRevenue,
    publisher_revenue: publisherRevenue,
    gross_cpm: grossCpm,
    net_cpm: netCpm,
    fee_percent: feePercent,
    revenue_validation: validation,
  };
}
