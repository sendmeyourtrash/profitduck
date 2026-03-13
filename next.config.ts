import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger file uploads (default is 4MB)
  serverExternalPackages: ["xlsx"],
};

export default nextConfig;
