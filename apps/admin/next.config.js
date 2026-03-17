/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@naro/shared'],
  reactStrictMode: true,

  // Proxy /uploads/* to the API server so images served by NestJS are accessible
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination: 'http://localhost:4000/uploads/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
