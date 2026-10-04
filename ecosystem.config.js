module.exports = {
  apps: [
    {
      name: 'naro-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      exec_mode: 'cluster',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        // Exported by deploy.sh; surfaced by GET /api/v1/health as `commit`.
        GIT_SHA: process.env.GIT_SHA || '',
      },
    },
    // The Next apps run the STANDALONE server (output: 'standalone'), exactly
    // as the live PM2 processes do. A standalone server only serves the
    // /_next/static + public files COPIED into its own folder — deploy.sh does
    // that after every build (missing copy = every CSS/JS 404s, see the
    // 2026-10-04 outage). server.js chdirs to its own dir, so cwd is only a
    // base for the relative script path. Keep exec_mode/instances matching
    // the live processes (`pm2 jlist`) — changing them needs `pm2 delete`.
    {
      name: 'naro-storefront',
      cwd: './apps/storefront',
      script: '.next/standalone/apps/storefront/server.js',
      exec_mode: 'cluster',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'naro-admin',
      cwd: './apps/admin',
      script: '.next/standalone/apps/admin/server.js',
      exec_mode: 'cluster',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
