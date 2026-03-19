module.exports = {
  apps: [
    {
      name: 'naro-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
    {
      name: 'naro-storefront',
      cwd: './apps/storefront',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'naro-admin',
      cwd: './apps/admin',
      script: 'node_modules/.bin/next',
      args: 'start -p 3001',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
