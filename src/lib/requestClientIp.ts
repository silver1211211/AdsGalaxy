import { isIP } from "node:net";

function normalizedIp(value: string | null) {
  const candidate = String(value || "").trim().replace(/^\[|\]$/g, "");
  return isIP(candidate) ? candidate.toLowerCase() : "";
}

export function getTrustedClientIp(request: Request) {
  // The production reverse proxy owns x-real-ip. If it is unavailable, use
  // the right-most XFF hop (the address appended by the nearest proxy), not
  // the attacker-controlled left-most value.
  const realIp = normalizedIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwarded = String(request.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((part) => normalizedIp(part))
    .filter(Boolean);
  if (forwarded.length > 0) return forwarded[forwarded.length - 1];

  const cloudflareIp = normalizedIp(request.headers.get("cf-connecting-ip"));
  return cloudflareIp || "unknown";
}
