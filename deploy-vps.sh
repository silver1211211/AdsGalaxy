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

env_value() {
  grep "^$1=" "$ENV_FILE" | cut -d'=' -f2- || true
}

require_env() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  if [ -z "$value" ]; then
    echo "  ERROR: Required environment variable is missing: $key"
    return 1
  fi
}

warn_env_any() {
  local name="$1"
  shift
  local key value found
  found=0
  for key in "$@"; do
    value="$(env_value "$key")"
    if [ -n "$value" ]; then found=1; fi
  done
  if [ "$found" -eq 0 ]; then
    echo "  WARNING: $name is not configured ($*). Verified reconciliation will skip this provider."
  fi
}

run_migration() {
  local file="$1"
  local name
  name=$(basename "$file")
  echo "  --> $name"
  [ -f "$file" ] || { echo "  ERROR: Required migration is missing: $name"; return 1; }
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$file"
}

echo "==> [1/5] Validating production environment..."
for KEY in \
  DB_HOST DB_PORT DB_USER DB_PASS DB_NAME \
  ADMIN_SESSION_SECRET CRON_SECRET BOT_TOKEN TELEGRAM_WEBHOOK_SECRET_TOKEN \
  BOT_ADD_USER_SECRET BOT_INTEGRATION_ENCRYPTION_KEY PRIVATE_INVITE_LINK_ENCRYPTION_KEY MINIAPP_STATS_SECRET \
  NEXT_PUBLIC_APP_URL NEXT_PUBLIC_SDK_URL NEXT_PUBLIC_API_BASE_URL
do
  require_env "$KEY"
done
echo "    Provider reporting verification:"
echo "      AdsGram: SDK/blockId verified; no public reporting API wired."
echo "      Monetag: SDK/postbacks verified; no public pull reporting API wired."
echo "      RichAds: publisher/widget JS tag verified; no public reporting API wired."
echo "      GigaPub: SDK project ID support only; no verified reporting API wired."
warn_env_any "AdExium reporting API token" "ADEXIUM_API_KEY" "ADEXIUM_API_TOKEN" "ADEXIUM_REPORTING_TOKEN"
warn_env_any "Monetag browser SDK URL" "MONETAG_SDK_URL" "NEXT_PUBLIC_MONETAG_SDK_URL"
echo "    Required environment variables are present."

echo "==> [2/5] Applying database migrations..."

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
  "20260628_0047_publisher_bot_webhooks.sql" \
  "20260630_0053_store_publisher_bot_webhook_urls.sql" \
  "20260701_0054_bot_forwarded_start_integration.sql" \
  "20260701_0055_channel_view_fetch_engine.sql" \
  "20260701_0056_channel_statistics_foundation.sql" \
  "20260701_0057_channel_settlement_engine.sql" \
  "20260701_0058_channel_settlement_margin_reserve.sql" \
  "20260701_0059_channel_publisher_quality_engine.sql" \
  "20260701_0060_channel_distribution_statistics.sql" \
  "20260701_0061_channel_monetization_verification_fixes.sql" \
  "20260701_0062_channel_fraud_detection.sql" \
  "20260701_0063_publisher_trust_enforcement.sql" \
  "20260701_0064_admin_channel_control_center.sql" \
  "20260701_0065_channel_health_monitor.sql" \
  "20260702_0066_channel_post_expiry.sql" \
  "20260702_0067_referral_join_immediate_credit.sql" \
  "20260702_0068_miniapp_integration_hardening.sql" \
  "20260703_0069_channel_post_stats_lookup_index.sql" \
  "20260703_0070_miniapp_payg_cpm_billing.sql" \
  "20260703_0071_miniapp_manual_approval_gate.sql" \
  "20260703_0072_campaign_inventory_exclusions.sql" \
  "20260703_0073_channel_fraud_billing_policy.sql" \
  "20260703_0074_bot_user_reachability_status.sql" \
  "20260703_0074_publisher_monetize_schema_compat.sql" \
  "20260703_0075_richads_telegram_configuration.sql" \
  "20260703_0076_remove_miniapp_beta_access.sql" \
  "20260703_0077_publisher_notifications_and_welcome_post.sql" \
  "20260705_0076_miniapp_network_health_counter_safety.sql" \
  "20260705_0077_miniapp_campaign_logo_remoderation.sql" \
  "20260704_0078_miniapp_telegram_bot_id.sql" \
  "20260705_0079_bot_monetization_integrity.sql" \
  "20260705_0080_miniapp_revenue_optimizer.sql" \
  "20260705_0081_phase_6b_campaign_budgets.sql" \
  "20260705_0082_phase_6c_fast_debit_ledgers.sql" \
  "20260705_0083_phase_6d_external_network_reconciliation.sql" \
  "20260706_0084_phase_6f_performance_hardening.sql" \
  "20260706_0085_production_schema_repair.sql" \
  "20260706_0086_user_negative_balance_guards.sql" \
  "20260706_0087_support_account_messaging.sql" \
  "20260706_0088_support_message_backfill_controls.sql"
do
  FILE="$APP_DIR/db/migrations/$MIG"
  run_migration "$FILE"
done

echo "    All migrations applied."

echo "==> [3/5] Cleaning stale Next.js build artifacts..."
rm -rf "$APP_DIR/.next"
echo "    .next removed."

echo "==> [4/5] Rebuilding application..."
NODE_ENV=production npm run build \
  && echo "    Build succeeded." \
  || { echo "    ERROR: Build failed. PM2 will NOT be restarted."; exit 1; }

echo "==> [5/5] Restarting PM2 process: $PM2_APP..."
pm2 restart "$PM2_APP" \
  && echo "    PM2 restarted." \
  || { echo "    WARNING: pm2 restart failed — trying reload..."; pm2 reload "$PM2_APP"; }

pm2 save

# Install one managed, idempotent production cron block.
CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2-)
if [ -z "$CRON_SECRET" ]; then
  echo "    WARNING: CRON_SECRET is missing; production crons were not installed."
else
  CRON_BASE='curl -fsS --max-time 240 -H "x-cron-secret: '"$CRON_SECRET"'" https://app.adsgalaxy.online/api/cron'
  CRON_BEGIN="# BEGIN ADSGALAXY MANAGED CRONS"
  CRON_END="# END ADSGALAXY MANAGED CRONS"
  EXISTING_CRONTAB=$(crontab -l 2>/dev/null || true)
  CLEAN_CRONTAB=$(printf '%s\n' "$EXISTING_CRONTAB" | awk -v begin="$CRON_BEGIN" -v end="$CRON_END" '
    $0 == begin { managed=1; next }
    $0 == end { managed=0; next }
    !managed
  ' | grep -Ev '/api/cron/(process-ads|process-broadcast|update-views|channel-settlement|settle-views|settle-clicks|settle-broadcast-publishers|external-network-revenue-sync|publisher-trust-enforcement|channel-fraud-detection|channel-health-monitor|unlock-balances|unlock-miniapp|settle-miniapp|update-subscribers|traffic-quality|inventory-optimization|miniapp-revenue-optimizer|process-support-messages|system-logs-cleanup|developer-webhooks|delete-expired-posts|cleanup-posts|cleanup-expired-posts|cleanup-expired-channel-views|referral-sprint)([[:space:]?]|$)' || true)

  {
    printf '%s\n' "$CLEAN_CRONTAB"
    echo "$CRON_BEGIN"
    # Phase 6C timing: delivery workers stay real-time; publisher settlement and
    # provider synchronization run only at their explicitly scheduled cadence.
    echo "* * * * * $CRON_BASE/process-ads >/dev/null 2>&1"
    echo "* * * * * $CRON_BASE/process-broadcast >/dev/null 2>&1"
    echo "*/15 * * * * $CRON_BASE/update-views >/dev/null 2>&1"
    echo "3 * * * * $CRON_BASE/channel-settlement >/dev/null 2>&1"
    echo "8-59/15 * * * * $CRON_BASE/settle-broadcast-publishers >/dev/null 2>&1"
    echo "17 * * * * $CRON_BASE/publisher-trust-enforcement >/dev/null 2>&1"
    echo "*/30 * * * * $CRON_BASE/channel-fraud-detection >/dev/null 2>&1"
    echo "7-59/15 * * * * $CRON_BASE/channel-health-monitor >/dev/null 2>&1"
    echo "*/5 * * * * $CRON_BASE/unlock-balances >/dev/null 2>&1"
    echo "1-59/5 * * * * $CRON_BASE/unlock-miniapp >/dev/null 2>&1"
    echo "6-59/15 * * * * $CRON_BASE/settle-miniapp >/dev/null 2>&1"
    echo "27 * * * * $CRON_BASE/external-network-revenue-sync >/dev/null 2>&1"
    echo "25 */6 * * * $CRON_BASE/update-subscribers >/dev/null 2>&1"
    echo "12 * * * * $CRON_BASE/traffic-quality >/dev/null 2>&1"
    echo "35 2 * * * $CRON_BASE/inventory-optimization >/dev/null 2>&1"
    echo "42 * * * * $CRON_BASE/miniapp-revenue-optimizer >/dev/null 2>&1"
    echo "*/10 * * * * $CRON_BASE/process-support-messages >/dev/null 2>&1"
    echo "45 3 * * * $CRON_BASE/system-logs-cleanup >/dev/null 2>&1"
    echo "*/15 * * * * $CRON_BASE/developer-webhooks >/dev/null 2>&1"
    echo "*/30 * * * * $CRON_BASE/cleanup-expired-posts >/dev/null 2>&1"
    echo "*/30 * * * * $CRON_BASE/cleanup-expired-channel-views >/dev/null 2>&1"
    echo "2 0 * * * $CRON_BASE/referral-sprint >/dev/null 2>&1"
    echo "$CRON_END"
  } | sed '/^[[:space:]]*$/d' | crontab -
  echo "    Production crons installed without duplicate routes."
fi

# Private-channel schema verification (do not rerun one-time migrations here):
# SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
# WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channels'
#   AND COLUMN_NAME IN ('channel_type','tracking_account','tracking_account_status',
#     'view_tracking_status','invite_link_hash','private_invite_link_encrypted');
# Expected: all six rows. They are supplied by one-time migrations 0046, 0051, and 0052
# and consolidated by one-time launch migration 9999. Those migrations must already have
# been applied before this recurring deploy script is used; do not duplicate them here.

echo ""
echo "==> Deployment complete. Checking application status..."
pm2 status "$PM2_APP"

echo ""
echo "==> Tailing logs for 20 seconds (Ctrl-C to stop early)..."
timeout 20 pm2 logs "$PM2_APP" --lines 50 2>/dev/null || true

echo ""
echo "Done. Verify at: https://app.adsgalaxy.online"
