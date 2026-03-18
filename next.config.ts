import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger file uploads (default is 4MB)
  serverExternalPackages: ["xlsx", "pdf.js-extract", "pdf-parse", "canvas"],
};

export default nextConfig;
