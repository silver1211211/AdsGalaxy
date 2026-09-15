import localFont from "next/font/local";
import Script from "next/script";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

import { HeaderProvider } from "@/context/HeaderContext";
import { PopupQueueProvider } from "@/context/PopupQueueContext";
import { LocalizationProvider } from "@/i18n/client";

import TelegramScript from "@/components/shared/TelegramScript";
import { DEFAULT_LOCALE, isLocale } from "@/i18n";

const appBuildMarker = process.env.NEXT_PUBLIC_APP_VERSION || "ui-render-stability-20260621";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get("ag_locale")?.value;
  const initialLocale = isLocale(savedLocale) ? savedLocale : DEFAULT_LOCALE;

  return (
    <html
      lang={initialLocale}
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        {/* Forces a light chrome/status-bar color and tells the rendering
            engine this page is light-only, so Android WebView's "force dark"
            (used by Telegram's Android app) does not auto-darken the page. */}
        <meta name="theme-color" content="#ffffff" />
        <meta name="color-scheme" content="light" />
        <meta name="adsgalaxy-build" content={appBuildMarker} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Script
          id="telegram-web-app-js"
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <TelegramScript />
        <LocalizationProvider initialLocale={initialLocale}>
          <PopupQueueProvider>
            <HeaderProvider>
              {children}
            </HeaderProvider>
          </PopupQueueProvider>
        </LocalizationProvider>
      </body>
    </html>
  );
}
