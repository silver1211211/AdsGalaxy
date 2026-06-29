import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { HeaderProvider } from "@/context/HeaderContext";
import { PopupQueueProvider } from "@/context/PopupQueueContext";

import TelegramScript from "@/components/shared/TelegramScript";

const appBuildMarker = process.env.NEXT_PUBLIC_APP_VERSION || "ui-render-stability-20260621";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="adsgalaxy-build" content={appBuildMarker} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TelegramScript />
        <PopupQueueProvider>
          <HeaderProvider>
            {children}
          </HeaderProvider>
        </PopupQueueProvider>
      </body>
    </html>
  );
}
