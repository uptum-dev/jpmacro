#!/bin/bash
# VPS first-time setup script
# Usage: bash deploy.sh
set -e

echo "=== jpmacro deploy ==="

# 1. Pull latest code
git pull

# 2. Build image
docker compose -f docker-compose.prod.yml build

# 3. Start DB first, wait for healthy
docker compose -f docker-compose.prod.yml up -d db
echo "Waiting for DB..."
sleep 5

# 4. Run schema migration (idempotent)
docker compose -f docker-compose.prod.yml run --rm app \
  node_modules/.bin/tsx scripts/migrate.ts

# 5. Seed data if wage_data is empty
COUNT=$(docker compose -f docker-compose.prod.yml exec -T db \
  psql -U jpmacro -d jpmacro -tAc "SELECT COUNT(*) FROM wage_data" 2>/dev/null || echo 0)
if [ "$COUNT" -eq 0 ]; then
  echo "Seeding data..."
  docker compose -f docker-compose.prod.yml run --rm app \
    node_modules/.bin/tsx scripts/refresh.ts
  docker compose -f docker-compose.prod.yml run --rm app \
    node_modules/.bin/tsx scripts/import_mhlw.ts
else
  echo "wage_data has ${COUNT} rows, skipping seed"
fi

# 6. Start all services
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "Done. Check logs: docker compose -f docker-compose.prod.yml logs -f app"
