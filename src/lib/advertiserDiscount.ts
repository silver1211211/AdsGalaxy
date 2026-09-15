import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type AdvertiserDiscountMode = "cpm" | "cpc";
export type AdvertiserDiscount = {
  cpm_discount: number;
  cpc_discount: number;
  expires_at: string | Date | null;
  active: boolean;
};

type Db = Pool | PoolConnection;

export function discountModeForCampaign(type: string): AdvertiserDiscountMode {
  return type === "clicks" ? "cpc" : "cpm";
}

export function effectiveBidPerThousand(bid: unknown, discount: unknown) {
  const gross = Number(bid || 0);
  const reduction = Math.max(0, Number(discount || 0));
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Number(Math.max(0.01, gross - reduction).toFixed(8));
}

export async function getAdvertiserDiscount(db: Db, userId: number): Promise<AdvertiserDiscount> {
  const [rows] = await db.query<Array<RowDataPacket & {
    cpm_discount: string | number;
    cpc_discount: string | number;
    expires_at: string | Date | null;
    is_active: string | number;
  }>>(
    "SELECT cpm_discount,cpc_discount,expires_at,(expires_at > UTC_TIMESTAMP()) AS is_active FROM advertiser_rate_discounts WHERE user_id=? LIMIT 1",
    [userId],
  );
  const row = rows[0];
  const expiresAt = row?.expires_at || null;
  const active = Number(row?.is_active || 0) === 1;
  return {
    cpm_discount: active ? Math.max(0, Number(row?.cpm_discount || 0)) : 0,
    cpc_discount: active ? Math.max(0, Number(row?.cpc_discount || 0)) : 0,
    expires_at: expiresAt,
    active,
  };
}
