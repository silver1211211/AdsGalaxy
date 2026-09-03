# Ads Galaxy Final Predeploy Report — 2026-09-02

## Revenue splits

- Bot Broadcast: existing publisher/reserve controls, calculated platform remainder, atomic validation, and authoritative broadcast settlement use remain intact. Split changes now also use the existing admin action audit infrastructure.
- Channel: added a matching card/modal. Admin submits publisher and reserve together; platform is calculated as `100 - publisher - reserve`. The values are converted into the existing authoritative `platform_margin_percent` and post-platform `safety_reserve_percent` policy, so no competing formula was introduced. Existing idempotent settlement and historical earnings are unchanged.
- Mini App: added a matching card/modal. Admin submits publisher maximum and reserve together; platform minimum is calculated as the remainder. Values update only the v2 maximum-share/reserve envelope used by future calculations.

## Dynamic CPM protection

- Dynamic CPM v2 remains dynamic and can pay below the publisher maximum or zero based on GEO, demand/yield, uniqueness, frequency, quality, trust, and fraud.
- GEO tables/bands, frequency, quality, trust, fraud, formula version, telemetry/identity internals, required margin, and the absolute CPM cap are hidden from normal Platform Settings and rejected by the normal admin mutation API.
- The `$11 CPM` absolute publisher ceiling remains system-controlled and enforced.
- Legacy Mini App split storage and raw Channel policy storage are hidden/read-only through the normal admin settings API, preventing competing controls.

## Audit logging

- Channel and Mini App split changes record the admin actor plus old/new publisher, reserve, and calculated platform values through `admin_action_audits`; table timestamps provide the change time.
- No secrets are logged.

## Preserved work

- Channel safety, fair fraud coverage, telemetry, risk aggregation, withdrawal pre-clearance, ledgers, GEO confidence, test-account exemption, permanent-ID recovery, Audience Analytics active inventory handling, and the intentional 8.4 USDT enforcement threshold remain present and pass focused tests.
- Mini App dynamic CPM v2, trusted GEO, repeat decay, zero payout, 50% default envelope, `$11` cap, quality/trust/fraud factors, provider-yield-backed external payout, fixed-mode safeguards, corrected reporting, callbacks, and external delivery sync remain present and pass focused tests.

## Validation

- Focused tests (Node 24.15.0): PASS — 113/113. Post-type-fix Mini App/revenue subset: PASS — 37/37.
- Focused ESLint: PASS — 0 errors, 2 existing `no-img-element` optimization warnings.
- Full TypeScript `tsc --noEmit` (Node 24.15.0): PASS.
- `git diff --check`: PASS.
- `bash -n deploy-vps.sh`: PASS.
- Isolated production build: NOT RUN. The single-core production host remained at load averages around 11–14 after repeated waits. Starting a production build was judged unsafe. No `.next-build` promotion or live `.next` replacement occurred.

## Migration and deployment review

- No new revenue-split migration is needed; the existing settings architecture is used.
- `deploy-vps.sh` includes direct callbacks (`0109`), external delivery sync (`0122`), Channel safety (`0123`), and Mini App dynamic CPM v2 (`0124`) in order.
- The script builds into `.next-build`, promotes only after successful build/manifests, retains `.next-previous`, restarts both `AdsFusionApp` and `AdsFusionCron`, and installs one managed cron block including external Mini App sync.
- The managed-cron cleanup removes the old `scripts/sync-channel-identities.sh` entry instead of restoring it.

## Remaining blocker

- Run the isolated Node 24 production build when server load is safe. Deployment, production migrations, PM2 restarts, and cron installation were intentionally not performed.
