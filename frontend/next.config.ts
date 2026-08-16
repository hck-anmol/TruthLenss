import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large video uploads (up to 200MB) — needed for video deepfake analysis
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
  },
};

export default nextConfig;
