import type { NextConfig } from "next";

// The web app is a pure client of the data API. All dynamic data and the
// pipeline's static products are served by @meteozini/api; these rewrites keep
// the existing same-origin URLs working without touching client code.
const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@meteozini/core"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_BASE}/v1/api/:path*` },
      { source: "/up/api/:path*", destination: `${API_BASE}/v1/api/:path*` },
      { source: "/up/static/:path*", destination: `${API_BASE}/v1/static/:path*` },
    ];
  },
};

export default nextConfig;
