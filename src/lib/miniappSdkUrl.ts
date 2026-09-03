const DEFAULT_MINIAPP_SDK_URL = "https://app.adsgalaxy.online/sdk.js";

function normalizedSdkUrl(candidates: Array<string | null | undefined>) {
  for (const candidate of [...candidates, DEFAULT_MINIAPP_SDK_URL]) {
    const value = String(candidate || "").trim();
    if (!value) continue;

    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;

      const withoutTrailingSlashes = url.pathname.replace(/\/+$/, "");
      const withoutSdkSuffix = withoutTrailingSlashes.replace(/(?:\/sdk\.js)+$/i, "");
      url.pathname = `${withoutSdkSuffix}/sdk.js`.replace(/^\/\//, "/");
      url.hash = "";
      return url;
    } catch {
      // Try the next configured fallback.
    }
  }

  return new URL(DEFAULT_MINIAPP_SDK_URL);
}

export function buildMiniappSdkUrl(
  miniappId: number | string,
  ...candidates: Array<string | null | undefined>
) {
  const numericId = Number(miniappId);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const url = normalizedSdkUrl(candidates);
  url.searchParams.set("id", String(numericId));
  return url.toString();
}

export function buildMiniappSdkTemplateUrl(
  placeholder: string,
  ...candidates: Array<string | null | undefined>
) {
  const cleanedPlaceholder = String(placeholder || "").trim();
  if (!cleanedPlaceholder) return null;

  const url = normalizedSdkUrl(candidates);
  url.searchParams.set("id", cleanedPlaceholder);
  return url.toString();
}
