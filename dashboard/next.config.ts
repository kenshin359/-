import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/VPS配置用: 依存を同梱した最小の実行ファイル群を .next/standalone に出力
  output: "standalone",
};

export default nextConfig;
