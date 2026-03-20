/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  output: 'standalone', // Note: may cause EPERM symlink errors on OneDrive-synced directories

  transpilePackages: ['@naro/shared'],
  reactStrictMode: true,

  async rewrites() {
    const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');
    return [
      {
        source: '/uploads/:path*',
        destination: `${apiOrigin}/uploads/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
