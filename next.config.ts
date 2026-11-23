import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      // The sample file is served from its single source in fixtures/: the bundler emits
      // the imported file as it is and the import gives its URL (src/lib/sample.ts).
      "*.csv": {
        type: "asset",
      },
    },
  },
};

export default nextConfig;
