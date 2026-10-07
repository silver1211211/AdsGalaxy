export type ChannelBillingKind = "view" | "click";

export function money(value: number) {
  return Number(Math.max(0, value).toFixed(8));
}

export function getChannelBidPerThousand(input: {
  type: "views" | "clicks" | string;
  cpm?: string | number | null;
  cpc?: string | number | null;
  discount?: string | number | null;
}) {
  const bid = input.type === "clicks" ? Number(input.cpc || 0) : Number(input.cpm || 0);
  const discount = Math.max(0, Number(input.discount || 0));
  if (!Number.isFinite(bid) || bid <= 0) return 0;
  return Number(Math.max(0.01, bid - discount).toFixed(8));
}

export function getChannelUnitPrice(input: {
  type: "views" | "clicks" | string;
  cpm?: string | number | null;
  cpc?: string | number | null;
  discount?: string | number | null;
}) {
  const effectiveBid = getChannelBidPerThousand(input);
  // Both configured Channel rates (and discounts) are per 1,000 units.
  return effectiveBid / 1000;
}

/** Trusted SQL aliases only. Teaser economics are deliberately unchanged. */
export function channelUnitPriceSql(alias = "c", discount = `COALESCE((SELECT CASE WHEN rate_discount.expires_at>UTC_TIMESTAMP() THEN IF(${alias}.type='clicks',rate_discount.cpc_discount,rate_discount.cpm_discount) ELSE 0 END FROM advertiser_rate_discounts rate_discount WHERE rate_discount.user_id=${alias}.user_id),0)`, preserveLegacyTeaser = true) {
  const bid = `CASE WHEN ${alias}.type='clicks' THEN COALESCE(${alias}.cpc,0) ELSE COALESCE(${alias}.cpm,0) END`;
  return `CASE WHEN ${alias}.campaign_kind='channel_growth' THEN COALESCE(${alias}.cost_per_subscriber,0)
    ${preserveLegacyTeaser ? `WHEN COALESCE(${alias}.teaser_mode,'none')<>'none' THEN CASE WHEN ${alias}.type='clicks' THEN GREATEST(COALESCE(${alias}.cpc,0),0.01) ELSE GREATEST(COALESCE(${alias}.cpm,0),0.01)/1000 END` : ""}
    WHEN (${bid})<=0 THEN 0
    ELSE GREATEST(0.01,(${bid})-GREATEST(0,${discount}))/1000 END`;
}

export function calculateChannelAdvertiserDebit(input: {
  type: "views" | "clicks" | string;
  units: number;
  cpm?: string | number | null;
  cpc?: string | number | null;
  discount?: string | number | null;
}) {
  return money(Math.max(0, Math.floor(input.units || 0)) * getChannelUnitPrice(input));
}
