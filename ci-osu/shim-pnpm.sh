#!/usr/bin/env bash
# REHEARSAL ONLY: what is under test is PM2 supervision and neighbour
# isolation, not the builds. So `pnpm install` is skipped (node_modules were
# installed by CI), the API build keeps the dist CI already built, and the two
# Next builds produce a stand-in standalone server (BUILD_ID, routes-manifest,
# one static CSS asset). Everything else (prisma generate / migrate status /
# migrate deploy / migrate diff) runs the REAL pnpm against the throwaway DB.
echo "pnpm $*" >> /var/log/pnpm-shim.log
if [ "${1:-}" = "install" ]; then exit 0; fi
if [ "${1:-}" = "--filter" ] && [ "${3:-}" = "build" ]; then
  app="$2"
  case "$app" in
    api) [ -f apps/api/dist/main.js ] && exit 0; exit 1 ;;
    storefront|admin)
      d="apps/$app/.next"
      rm -rf "$d"
      mkdir -p "$d/static/css" "$d/standalone/apps/$app"
      git rev-parse HEAD | sed "s/\$/-$app/" > "$d/BUILD_ID"
      echo '{}' > "$d/routes-manifest.json"
      echo 'body{}' > "$d/static/css/app.css"
      cp __STANDIN__ "$d/standalone/apps/$app/server.js"
      exit 0 ;;
  esac
fi
exec __REAL_PNPM__ "$@"
