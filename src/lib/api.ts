export async function apiFetch(url: string, options: RequestInit = {}) {
  // Accessing Telegram WebApp from the window object
  const initData = typeof window !== "undefined" ? (window as any).Telegram?.WebApp?.initData : "";

  const headers: any = {
    ...options.headers,
    "x-telegram-init-data": initData || "",
  };

  // Only set Content-Type to JSON if not sending FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  return response;
}
