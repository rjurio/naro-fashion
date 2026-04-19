#!/bin/bash
set -e

echo "🚀 Deploying Naro Fashion..."

cd /var/www/naro-fashion

# Pull latest code
git pull origin master

# Install dependencies
pnpm install

# Generate Prisma client & push schema
cd packages/database
npx prisma generate
npx prisma db push --accept-data-loss
cd ../..

# Build all apps
pnpm build

# Copy static assets + public dir into the Next.js standalone output.
# PM2 runs the standalone server.js, which does NOT auto-include these
# — without this step, every freshly-built HTML references hashed JS
# chunks that don't exist on disk, producing a client-side
# ChunkLoadError and an "Application error" white page.
# See CLAUDE.md → Production Deployment → "Static assets".
for app in storefront admin; do
  standalone_dir="apps/${app}/.next/standalone/apps/${app}"
  if [ -d "${standalone_dir}" ]; then
    echo "📦 Syncing static + public for ${app}..."
    rm -rf "${standalone_dir}/.next/static" "${standalone_dir}/public"
    cp -r "apps/${app}/.next/static" "${standalone_dir}/.next/static"
    if [ -d "apps/${app}/public" ]; then
      cp -r "apps/${app}/public" "${standalone_dir}/public"
    fi
  fi
done

# Restart PM2 processes
pm2 restart ecosystem.config.js

echo "✅ Deployment complete!"
