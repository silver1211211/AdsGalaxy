import type { NextConfig } from "next";

const sdkCorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "POST,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type,x-telegram-init-data" },
  { key: "Access-Control-Max-Age", value: "86400" },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The private preview runs from this source tree in development mode.
  // Allow its browser origin so Turbopack HMR can update an open preview
  // without rebuilding or restarting the production application.
  allowedDevOrigins: [
    "preview.adsgalaxy.online",
    "curious-necessarily-hyacinth.ngrok-free.dev",
  ],
  async headers() {
    return [
      { source: "/api/sdk/:path*", headers: sdkCorsHeaders },
      { source: "/api/miniapp/internal-ads/:path*", headers: sdkCorsHeaders },
      { source: "/api/conversions/click", headers: sdkCorsHeaders },
    ];
  },
};

export default nextConfig;
