/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@naro/shared"],

  // i18n is handled via custom I18nProvider (client-side)
  // Supported locales: English (en), Swahili (sw)

  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  // Proxy /uploads/* to the API server so images served by NestJS are accessible
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "http://localhost:4000/uploads/:path*",
      },
    ];
  },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

module.exports = nextConfig;
