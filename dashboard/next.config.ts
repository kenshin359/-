import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/VPS配置用に standalone 出力。Vercel では不要なので付けない。
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
