export type ChannelBillingKind = "view" | "click";

export function money(value: number) {
  return Number(Math.max(0, value).toFixed(8));
}

export function getChannelBidPerThousand(input: {
  type: "views" | "clicks" | string;
  cpm?: string | number | null;
  cpc?: string | number | null;
}) {
  return input.type === "clicks" ? Number(input.cpc || 0) : Number(input.cpm || 0);
}

export function getChannelUnitPrice(input: {
  type: "views" | "clicks" | string;
  cpm?: string | number | null;
  cpc?: string | number | null;
}) {
  return getChannelBidPerThousand(input) / 1000;
}

export function calculateChannelAdvertiserDebit(input: {
  type: "views" | "clicks" | string;
  units: number;
  cpm?: string | number | null;
  cpc?: string | number | null;
}) {
  return money(Math.max(0, Math.floor(input.units || 0)) * getChannelUnitPrice(input));
}
