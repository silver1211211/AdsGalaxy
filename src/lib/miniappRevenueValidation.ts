import type { PoolConnection, RowDataPacket } from "mysql2/promise";

type RevenueLimitRow = RowDataPacket & {
  min_gross_cpm: string | number;
  max_gross_cpm: string | number;
  suspicious_gross_cpm: string | number;
  max_revenue_per_impression: string | number;
};

export type RevenueValidationResult = {
  status: "passed" | "suspicious" | "rejected";
  reason: string | null;
  metadata: Record<string, number | string>;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function validateMiniappRevenue(input: {
  conn: PoolConnection;
  networkName: string;
  impressions: number;
  grossRevenue: number;
}) {
  const impressions = Math.max(0, Math.floor(toNumber(input.impressions)));
  const grossRevenue = toNumber(input.grossRevenue);
  const grossCpm = impressions > 0 ? (grossRevenue / impressions) * 1000 : 0;

  const [rows] = await input.conn.query<RevenueLimitRow[]>(
    `SELECT min_gross_cpm, max_gross_cpm, suspicious_gross_cpm, max_revenue_per_impression
     FROM miniapp_network_revenue_limits
     WHERE network_name = ? AND active = 1
     LIMIT 1`,
    [input.networkName]
  );

  const limits = rows[0] || {
    min_gross_cpm: 0,
    max_gross_cpm: 60,
    suspicious_gross_cpm: 30,
    max_revenue_per_impression: 0.06,
  };

  const metadata = {
    impressions,
    gross_revenue: grossRevenue,
    gross_cpm: grossCpm,
    min_gross_cpm: toNumber(limits.min_gross_cpm),
    max_gross_cpm: toNumber(limits.max_gross_cpm),
    suspicious_gross_cpm: toNumber(limits.suspicious_gross_cpm),
    max_revenue_per_impression: toNumber(limits.max_revenue_per_impression),
  };

  if (impressions < 1) {
    return { status: "rejected", reason: "impressions_must_be_positive", metadata } satisfies RevenueValidationResult;
  }

  if (!Number.isFinite(grossRevenue) || grossRevenue < 0) {
    return { status: "rejected", reason: "gross_revenue_invalid", metadata } satisfies RevenueValidationResult;
  }

  if (grossRevenue > impressions * metadata.max_revenue_per_impression) {
    return { status: "rejected", reason: "gross_revenue_exceeds_per_impression_ceiling", metadata } satisfies RevenueValidationResult;
  }

  if (grossCpm < metadata.min_gross_cpm || grossCpm > metadata.max_gross_cpm) {
    return { status: "rejected", reason: "gross_cpm_outside_network_limits", metadata } satisfies RevenueValidationResult;
  }

  if (grossCpm >= metadata.suspicious_gross_cpm) {
    return { status: "suspicious", reason: "gross_cpm_above_suspicious_threshold", metadata } satisfies RevenueValidationResult;
  }

  return { status: "passed", reason: null, metadata } satisfies RevenueValidationResult;
}
