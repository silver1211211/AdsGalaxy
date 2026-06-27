export const VPN_POLICIES = ["allow_all", "prefer_non_vpn", "exclude_vpn"] as const;
export const DEVICE_POLICIES = ["all", "mobile", "desktop"] as const;
export const OS_POLICIES = ["all", "android", "ios", "desktop_web"] as const;

export type VpnPolicy = typeof VPN_POLICIES[number];
export type DevicePolicy = typeof DEVICE_POLICIES[number];
export type OsPolicy = typeof OS_POLICIES[number];

export type TargetingInput = {
  countries?: unknown;
  languages?: unknown;
  vpn_policy?: unknown;
  device_policy?: unknown;
  os_policy?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  daily_budget_limit?: unknown;
  frequency_cap_per_user?: unknown;
};

export type NormalizedTargeting = {
  countries: string[];
  languages: string[];
  vpn_policy: VpnPolicy;
  device_policy: DevicePolicy;
  os_policy: OsPolicy;
  start_at: string | null;
  end_at: string | null;
  daily_budget_limit: number | null;
  frequency_cap_per_user: number | null;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function parseList(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const raw = cleanText(value);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(cleanText).filter(Boolean);
  } catch {
    // Comma-separated input is supported for simple forms.
  }

  return raw.split(",").map(cleanText).filter(Boolean);
}

function normalizeCountries(value: unknown) {
  const countries = Array.from(new Set(parseList(value).map((country) => country.toUpperCase())));
  for (const country of countries) {
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new Error("Countries must use 2-letter country codes");
    }
  }
  return countries;
}

function normalizeLanguages(value: unknown) {
  const languages = Array.from(new Set(parseList(value).map((language) => language.toLowerCase())));
  for (const language of languages) {
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(language)) {
      throw new Error("Languages must use ISO language codes");
    }
  }
  return languages;
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], field: string): T[number] {
  const normalized = cleanText(value) || fallback;
  if (!allowed.includes(normalized)) {
    throw new Error(`${field} is not supported`);
  }
  return normalized;
}

function normalizeDateTime(value: unknown, field: string) {
  const raw = cleanText(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeOptionalMoney(value: unknown, field: string) {
  const raw = cleanText(value);
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${field} must be greater than 0`);
  }
  return amount;
}

function normalizeOptionalInteger(value: unknown, field: string) {
  const raw = cleanText(value);
  if (!raw) return null;
  const valueNumber = Number(raw);
  if (!Number.isInteger(valueNumber) || valueNumber <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return valueNumber;
}

export function normalizeAdvertiserTargeting(input: TargetingInput, totalBudget: number): NormalizedTargeting {
  const startAt = normalizeDateTime(input.start_at, "Start date");
  const endAt = normalizeDateTime(input.end_at, "End date");

  if (startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    throw new Error("Start date must be before end date");
  }

  const dailyBudgetLimit = normalizeOptionalMoney(input.daily_budget_limit, "Daily budget limit");
  if (dailyBudgetLimit !== null && dailyBudgetLimit > totalBudget) {
    throw new Error("Daily budget limit cannot exceed total campaign budget");
  }

  return {
    countries: normalizeCountries(input.countries),
    languages: normalizeLanguages(input.languages),
    vpn_policy: normalizeEnum(input.vpn_policy, VPN_POLICIES, "allow_all", "VPN policy") as VpnPolicy,
    device_policy: normalizeEnum(input.device_policy, DEVICE_POLICIES, "all", "Device policy") as DevicePolicy,
    os_policy: normalizeEnum(input.os_policy, OS_POLICIES, "all", "Platform policy") as OsPolicy,
    start_at: startAt,
    end_at: endAt,
    daily_budget_limit: dailyBudgetLimit,
    frequency_cap_per_user: normalizeOptionalInteger(input.frequency_cap_per_user, "Frequency cap"),
  };
}

export function targetingDbParams(targeting: NormalizedTargeting) {
  return [
    targeting.countries.length > 0 ? JSON.stringify(targeting.countries) : null,
    targeting.languages.length > 0 ? JSON.stringify(targeting.languages) : null,
    targeting.vpn_policy,
    targeting.device_policy,
    targeting.os_policy,
    targeting.start_at,
    targeting.end_at,
    targeting.daily_budget_limit,
    targeting.frequency_cap_per_user,
  ];
}

export function parseTargetingList(value: unknown): string[] {
  return parseList(value);
}

export function formatPolicy(value: unknown) {
  return cleanText(value).replace(/_/g, " ") || "all";
}
