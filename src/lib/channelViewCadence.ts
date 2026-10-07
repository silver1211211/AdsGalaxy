export const PUBLIC_VIEW_CADENCE = [[3600, 300], [21600, 900], [86400, 1800], [259200, 7200]] as const;
export const PRIVATE_VIEW_CADENCE = [[3600, 1800], [21600, 3600], [86400, 7200]] as const;

export function channelViewIntervalSeconds(ageSeconds: number, isPrivate: boolean) {
  return (isPrivate ? PRIVATE_VIEW_CADENCE : PUBLIC_VIEW_CADENCE)
    .find(([age]) => ageSeconds <= age)?.[1] ?? 21600;
}

export function channelViewCadenceSql(privateExpression: string) {
  const age = "TIMESTAMPDIFF(SECOND, cp.delivery_confirmed_at, UTC_TIMESTAMP())";
  const sql = (tiers: ReadonlyArray<readonly [number, number]>) =>
    `CASE ${tiers.map(([maxAge, interval]) => `WHEN ${age}<=${maxAge} THEN ${interval}`).join(" ")} ELSE 21600 END`;
  return `CASE WHEN ${privateExpression} THEN ${sql(PRIVATE_VIEW_CADENCE)} ELSE ${sql(PUBLIC_VIEW_CADENCE)} END`;
}
