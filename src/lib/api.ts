export async function apiFetch(url: string, options: RequestInit = {}) {
  // Accessing Telegram WebApp from the window object
  let initData = typeof window !== "undefined" ? (window as any).Telegram?.WebApp?.initData : "";

  // If on client and initData is missing, wait a bit for Telegram to initialize
  if (typeof window !== "undefined" && !initData) {
    let retries = 0;
    while (!(window as any).Telegram?.WebApp?.initData && retries < 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }
    initData = (window as any).Telegram?.WebApp?.initData;
  }

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
