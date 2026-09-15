export function safeOpenExternalUrl(url: string) {
  if (typeof window === "undefined") return;
  const parsed = new URL(url, window.location.origin);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  const telegram = (window as Window & { Telegram?: { WebApp?: { openLink?: (href: string) => void } } }).Telegram?.WebApp;
  if (telegram?.openLink) telegram.openLink(parsed.toString());
  else window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}
