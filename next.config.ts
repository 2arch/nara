import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_EXPORT ? 'export' : undefined,
  images: process.env.NEXT_EXPORT ? { unoptimized: true } : undefined,
  assetPrefix: process.env.NEXT_EXPORT ? './' : undefined,
  trailingSlash: false,
  basePath: process.env.NEXT_EXPORT ? '' : undefined,
  experimental: {
    // Any experimental features should be carefully configured
  }
};

export default nextConfig;
