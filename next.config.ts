import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_EXPORT ? 'export' : undefined,
  images: process.env.NEXT_EXPORT ? { unoptimized: true } : undefined,
  assetPrefix: process.env.NEXT_EXPORT ? './' : undefined,
  trailingSlash: false,
  basePath: process.env.NEXT_EXPORT ? '' : undefined,
  experimental: {
    // Any experimental features should be carefully configured
  },
  webpack: (config) => {
    // Handle .wgsl files as raw text strings
    config.module.rules.push({
      test: /\.wgsl$/,
      type: 'asset/source',
    });
    return config;
  },
};

export default nextConfig;
