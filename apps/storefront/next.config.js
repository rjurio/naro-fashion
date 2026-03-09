/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@naro/shared"],

  // i18n is handled via next-intl middleware for App Router
  // Supported locales: English (en), Swahili (sw)

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

module.exports = nextConfig;
