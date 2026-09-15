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
  return getChannelBidPerThousand(input) / 1000;
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
