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

# Restart PM2 processes
pm2 restart ecosystem.config.js

echo "✅ Deployment complete!"
