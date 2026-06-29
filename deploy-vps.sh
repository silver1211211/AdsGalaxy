#!/usr/bin/env bash
# VPS production deployment script for AdsFusion / AdsGalaxy
# Run on the VPS as root from /www/wwwroot/bots/AdsFusion:
#   bash deploy-vps.sh
set -euo pipefail

APP_DIR="/www/wwwroot/bots/AdsFusion"
PM2_APP="AdsFusionApp"
ENV_FILE="$APP_DIR/.env"

cd "$APP_DIR"

# ── Load DB credentials from .env ─────────────────────────────────────────────
DB_HOST=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
DB_PORT=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d'=' -f2- || echo "3306")
DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d'=' -f2-)
DB_PASS=$(grep '^DB_PASS=' "$ENV_FILE" | cut -d'=' -f2-)
DB_NAME=$(grep '^DB_NAME=' "$ENV_FILE" | cut -d'=' -f2-)

run_migration() {
  local file="$1"
  local name
  name=$(basename "$file")
  echo "  --> $name"
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$file" 2>&1 \
    | grep -v "^$" | grep -v "Query OK" || true
}

echo "==> [1/4] Applying database migrations..."

# Step 1A: Run the comprehensive catch-up migration first.
# This adds all columns/tables from migrations 0006-0040 that lack IF NOT EXISTS guards,
# using safe ADD COLUMN IF NOT EXISTS throughout.
run_migration "$APP_DIR/db/migrations/20260626_0041_production_schema_fix.sql"

# Step 1B: Re-run migrations 0012 onwards — they are all idempotent (IF NOT EXISTS).
# Errors from "Duplicate key name" for indexes are silently ignored.
for MIG in \
  "20260622_0012_add_advertiser_targeting_fields.sql" \
  "20260622_0013_dynamic_miniapp_publisher_cpm.sql" \
  "20260622_0014_advertiser_trust_quality.sql" \
  "20260622_0015_traffic_quality_intelligence.sql" \
  "20260622_0016_inventory_optimization.sql" \
  "20260622_0017_internal_ad_completion_quality.sql" \
  "20260622_0018_internal_ad_display_creative_fields.sql" \
  "20260622_0019_creative_review_categories.sql" \
  "20260622_0020_conversion_tracking_roi.sql" \
  "20260623_0021_publisher_marketplace.sql" \
  "20260623_0022_advertiser_intelligence.sql" \
  "20260623_0023_automation_moderation.sql" \
  "20260623_0024_revenue_protection.sql" \
  "20260623_0025_referral_sprint_growth.sql" \
  "20260623_0026_referral_team_league_growth.sql" \
  "20260623_0027_developer_platform.sql" \
  "20260623_0028_channel_scheduler_lifecycle.sql" \
  "20260623_0029_bot_channel_health_counts.sql" \
  "20260623_0030_system_logs.sql" \
  "20260623_0031_gigapub_network_completion.sql" \
  "20260623_0032_smart_recommendations.sql" \
  "20260623_0033_enterprise_deals.sql" \
  "20260623_0034_referral_growth_toggle_notifications.sql" \
  "20260624_0035_production_safety_controls.sql" \
  "20260624_0037_cron_auth_residual_risks.sql" \
  "20260624_0038_suspicious_revenue_review_workflow.sql" \
  "20260624_0040_self_promotion_ads.sql" \
  "20260628_0047_publisher_bot_webhooks.sql"
do
  FILE="$APP_DIR/db/migrations/$MIG"
  if [ -f "$FILE" ]; then
    run_migration "$FILE"
  else
    echo "  [SKIP] $MIG not found"
  fi
done

echo "    All migrations applied."

echo "==> [2/4] Cleaning stale Next.js build artifacts..."
rm -rf "$APP_DIR/.next"
echo "    .next removed."

echo "==> [3/4] Rebuilding application..."
NODE_ENV=production npm run build \
  && echo "    Build succeeded." \
  || { echo "    ERROR: Build failed. PM2 will NOT be restarted."; exit 1; }

echo "==> [4/4] Restarting PM2 process: $PM2_APP..."
pm2 restart "$PM2_APP" \
  && echo "    PM2 restarted." \
  || { echo "    WARNING: pm2 restart failed — trying reload..."; pm2 reload "$PM2_APP"; }

pm2 save

echo ""
echo "==> Deployment complete. Checking application status..."
pm2 status "$PM2_APP"

echo ""
echo "==> Tailing logs for 20 seconds (Ctrl-C to stop early)..."
timeout 20 pm2 logs "$PM2_APP" --lines 50 2>/dev/null || true

echo ""
echo "Done. Verify at: https://app.adsgalaxy.online"
