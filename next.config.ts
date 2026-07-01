import type { NextConfig } from "next";

const sdkCorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "POST,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type,x-telegram-init-data" },
  { key: "Access-Control-Max-Age", value: "86400" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["curious-necessarily-hyacinth.ngrok-free.dev"],
  async headers() {
    return [
      { source: "/api/sdk/:path*", headers: sdkCorsHeaders },
      { source: "/api/miniapp/internal-ads/:path*", headers: sdkCorsHeaders },
      { source: "/api/conversions/click", headers: sdkCorsHeaders },
    ];
  },
};

export default nextConfig;
