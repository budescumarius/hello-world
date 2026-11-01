import type { NextConfig } from "next";

/**
 * Application entièrement authentifiée et dynamique : Cache Components (opt-in en Next 16)
 * n'est pas activé, chaque page lit la session à la requête.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
