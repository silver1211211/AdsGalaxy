# AdsGalaxy Bot Monetization User Capture Audit Report

**Date:** 2026-07-10  
**Audit Type:** INSPECTION ONLY - No modifications made  
**Status:** Complete

---

## EXECUTIVE SUMMARY

**Product Expectation:** "AdsGalaxy should capture bot users when they send `/start`, even before the publisher completes the AdsGalaxy integration."

**Audit Conclusion:** ❌ **NOT CURRENTLY SUPPORTED**

The current architecture is fundamentally incompatible with this expectation. AdsGalaxy does not intercept Telegram updates directly. Instead, it relies on the publisher to explicitly send user data after they receive the update.

**Architecture Type:** Publisher-driven (PULL model), not AdsGalaxy-driven (PUSH model)

---

## PART 1: CURRENT BOT-USER ACQUISITION PATHS

### Path 1: Publisher Integration Endpoint (Primary)

**File:** `src/app/api/bot/integration/[botId]/[secret]/route.ts`  
**Route:** `POST /api/bot/integration/{botId}/{secret}`  
**Endpoint Type:** Publisher's backend → AdsGalaxy callback  
**Authentication:** Integration secret (HMAC-SHA256 hash verification)

**Trigger:** Publisher's backend must call this endpoint explicitly  
**Prerequisites:**
- Bot must be registered and approved (`status != 'paused'/'rejected'/'deleted'/'token_invalid'/'bot_deleted'/'unreachable'`)
- Publisher must have received the `/start` update from Telegram first
- Publisher's backend must construct the payload with user details

**Request Format:**
```json
{
  "bot_id": "123",
  "telegram_user_id": "9876543210",
  "chat_id": "9876543210",
  "username": "telegramusername",
  "first_name": "First",
  "language_code": "en",
  "request_id": "unique-request-id",
  "timestamp": 1234567890,
  "test": false
}
```

**User Recording Logic (Lines 127-168):**
1. Validates telegram_user_id or chat_id is present (line 131-133)
2. Attempts duplicate detection via SELECT ... FOR UPDATE (line 144-150)
3. On duplicate: updates existing user, increments `duplicate_start_count`, sets `status='active'` (line 152-159)
4. On new user: INSERTs into bot_users with `source='integration'`, `status='active'`, `is_active=TRUE` (line 161-168)
5. Updates bot's `integration_last_received_at`, `integration_installed_at`, `integration_last_user_id` (line 170-173)
6. Logs event to `bot_integration_events` table (line 175-178)

**Duplicate Prevention:**
- Via request_id_hash (line 110-114)
- Via SELECT FOR UPDATE on bot_users (line 146)
- Via ER_DUP_ENTRY exception handling (line 182-183)

**Database Tables Modified:**
- `bot_users`: INSERT new user or UPDATE existing
  - Columns: `bot_id`, `user_id`, `chat_id`, `telegram_username`, `telegram_first_name`, `telegram_language_code`, `registered_at`, `first_seen_at`, `last_seen_at`, `duplicate_start_count`, `integration_first_seen_at`, `source`, `is_active`, `status`
  - `source = 'integration'` (line 165)
  - `status = 'active'` (line 156)
- `bots`: UPDATE timestamp fields
  - `integration_installed_at = COALESCE(integration_installed_at, NOW())`
  - `integration_last_received_at = NOW()`
  - `integration_last_user_id = {telegramUserId}`
  - `integration_last_error_at = NULL`
  - `integration_last_error = NULL`
- `bot_integration_events`: INSERT audit log

**Status Assigned:** `'active'` (verified, reachable)

**Key Limitation:** Publisher must already be integrated and must call this endpoint. No automatic `/start` capture.

---

### Path 2: Manual Admin Import

**File:** `src/app/api/admin/bots/[id]/users/manual/route.ts`  
**Route:** `POST /api/admin/bots/{id}/users/manual`  
**Authentication:** Admin permission "operate"  
**User Source:** `source = 'manual_admin'` (line 53)

**Input:** Comma/newline-separated Telegram user IDs (lines 80, 14)  
**Validation:** Must match regex `/^[1-9]\d{4,19}$/` (line 20)  
**Max Per Import:** 5000 IDs (line 11)

**User Recording Logic (Lines 33-58):**
1. Checks for existing user via SELECT FOR UPDATE (line 35-36)
2. If exists: returns "existing" (line 39)
3. If new: INSERTs bot_users with `source='manual_admin'`, `status='pending_verification'`, `is_active=FALSE` (line 56)
4. Logs action to `admin_action_audits` (line 138-145)

**Database Tables Modified:**
- `bot_users`: INSERT only (no updates)
  - `source = 'manual_admin'`
  - `status = 'pending_verification'`
  - `is_active = FALSE`
- `admin_action_audits`: INSERT audit record

**Status Assigned:** `'pending_verification'` (not verified, not broadcast-eligible)

**Key Limitation:** Admin-only, requires manual intervention per bot, NOT automatic `/start` capture.

---

### Path 3: Broadcast User Attribution (Post-Delivery)

**Not a user acquisition path.** Broadcast delivery creates implicit user records only if user exists. Cannot capture new `/start` users.

---

### Path 4: Legacy Bot Webhook (DISABLED)

**File:** `src/app/api/bot/webhook/[botId]/[secret]/route.ts`  
**Status:** ❌ DISABLED (HTTP 410 Gone)

```typescript
export async function POST() {
  return NextResponse.json(
    { error: "Legacy webhook integration is disabled; publishers must keep their own webhook" },
    { status: 410 }
  );
}
```

**Why Disabled:** Developers added a note: "publishers must keep their own webhook"

**Implication:** AdsGalaxy has NEVER supported direct Telegram webhook interception for bot `/start` events.

---

### Summary: User Acquisition Paths

| Path | Source | Method | Auto-Capture /start | Requires Integration | Database Status | Admin-Only |
|------|--------|--------|---------------------|---------------------|-----------------|-----------|
| Publisher Integration Endpoint | Publisher callback | POST to integration URL | ❌ No | ❌ Yes (must code) | `active` | No |
| Manual Admin Import | Admin IDs | POST with ID list | ❌ No | N/A | `pending_verification` | ✓ Yes |
| ~~Legacy Bot Webhook~~ | ~~Telegram directly~~ | ~~POST to webhook~~ | ~~✓ Yes~~ | ~~No~~ | ~~`active`~~ | ~~No~~ |

**CRITICAL FINDING:** There is NO automatic `/start` capture path. The only way to capture bot users is for the publisher to explicitly call the integration endpoint AFTER receiving the update.

---

## PART 2: BOT SUBMISSION AND TOKEN OWNERSHIP FLOW

### Bot Token Submission Process

**File:** `src/app/api/publisher/bots/route.ts`  
**Route:** `POST /api/publisher/bots`  
**Authentication:** Publisher via Telegram initData

**Step 1: Token Validation (Lines 158-168)**
- Regex validation: `/^\d{5,15}:[A-Za-z0-9_-]{20,}$/` (line 160)
- Telegram getMe call: `fetch("https://api.telegram.org/bot{token}/getMe")`  (line 163)
- Timeout: 8 seconds (line 163)
- On failure: returns 400 error (line 167)

**Step 2: Bot Identity Check (Lines 170)**
- Extracts bot username and name from Telegram getMe response
- Stored as `bot_username`, `bot_name`

**Step 3: Ownership Verification (Lines 173-183)**
- Checks if bot token already exists via botTokenHash or plaintext match (line 174-175)
- If found AND belongs to different publisher: rejects with 400 (line 181-183)
- If found AND soft-deleted: reactivates it (line 189-212)

**Step 4: Bot Storage (Lines 217-220)**
```typescript
INSERT INTO bots (
  user_id, bot_token, bot_token_encrypted, bot_token_hash, 
  bot_username, bot_name, posts_per_day, continents, categories, 
  status='pending'
)
```

**Initial Status:** `'pending'` (line 218, 522)  
**NOT APPROVED YET**

**Step 5: Integration Secret Generation (Lines 222, 209)**
```typescript
const integrationUrl = await ensureBotIntegration(pool, new URL(request.url).origin, result.insertId);
```

**Generated by:** `ensureBotIntegration()` in `src/lib/botIntegration.ts:134-164`
- Generates random 32-byte base64url secret (line 153)
- Encrypts secret with AES-256-GCM (line 78-83)
- Stores encrypted secret and SHA256 hash in database (line 154-160)
- Returns URL: `/api/bot/integration/{botId}/{secret}` (line 163)

**Step 6: Response to Publisher (Line 225)**
```json
{
  "success": true,
  "id": 12345,
  "bot_id": 12345,
  "integration_url": "https://adsgalaxy.app/api/bot/integration/12345/agx_int_...",
  "status": 201
}
```

### Critical Finding: No Webhook Setup

**No `setWebhook` is called at any point during bot submission.**

**Test Integration Route** (`src/app/api/publisher/bots/[id]/test-integration/route.ts:128-130`) confirms this:
```typescript
const { data } = await telegramJson(token, "getWebhookInfo");
if (data.ok) {
  checks.push(check("telegram_webhook", "Webhook configuration valid", "success", 
    data.result?.url 
      ? "Telegram webhook is configured on the publisher bot." 
      : "No Telegram webhook is configured; polling or custom delivery may be used."
  ));
}
```

**Message explicitly states:** "No Telegram webhook is configured; polling or custom delivery may be used."

**Implication:** AdsGalaxy DOES NOT manage the publisher's bot webhook. The publisher keeps their own webhook/polling and calls AdsGalaxy's integration endpoint to share data.

---

## PART 3: TELEGRAM DELIVERY CONSTRAINT ANALYSIS

### Telegram Bot API Architecture

**Single Webhook Per Bot:**
- Telegram routes updates to exactly ONE webhook URL per bot
- Only one Telegram bot account can have one active webhook
- Setting a new webhook replaces the previous webhook URL
- Polling (getUpdates) is unavailable while a webhook is active
- Once webhook is set, Telegram will NOT send updates via polling

**Current AdsGalaxy Architecture:**

| Component | Webhook Control | Receives Updates | Forwards To AdsGalaxy |
|-----------|-----------------|------------------|----------------------|
| Telegram Bot API | N/A | Sends to ONE webhook | N/A |
| Publisher's Webhook | ✓ Publisher controls | ✓ Yes (from Telegram) | Manual via integration endpoint |
| AdsGalaxy Webhook | ✗ Not set | ✗ No | N/A |

### Can Both Coexist?

**Current Answer:** ❌ NO

**Scenario A: Publisher's Webhook is Active**
```
Telegram → {publisher_webhook_url}
         → Publisher receives /start
         → Publisher manually calls AdsGalaxy integration URL
         → AdsGalaxy records user
         → Publisher processes /start with own logic
```
**Result:** ✓ Works, but requires publisher integration

**Scenario B: AdsGalaxy Sets a Webhook**
```
Telegram → {adsgalaxy_webhook_url}  [Publisher's previous webhook is DELETED]
         → AdsGalaxy receives /start
         → AdsGalaxy stores user
         → AdsGalaxy forwards to publisher backend (how? where?)
         → Publisher processes /start with own logic
```
**Result:** ✗ Breaks because:
1. Telegram can only have ONE webhook URL
2. Setting AdsGalaxy's webhook would REPLACE publisher's webhook
3. AdsGalaxy would need to forward updates, but:
   - No standardized format (Telegram update object? custom schema?)
   - No target URL (where is publisher's backend?)
   - No delivery guarantee (what if forward fails?)
   - Creates duplicate update problem if publisher also calls integration endpoint

**Scenario C: Neither Has Webhook (Polling)**
```
Publisher uses getUpdates polling
→ Publisher gets /start
→ Publisher calls AdsGalaxy integration URL
```
**Result:** ✓ Works (current implementation)

### Conclusion on Coexistence

**Direct coexistence is NOT possible because Telegram allows only one webhook per bot.** 

AdsGalaxy can either:
1. **NOT set a webhook** (current): Publisher manages their own, calls integration endpoint
2. **Set a webhook** (proposed): Publisher's webhook would be deleted; AdsGalaxy must forward

Option 2 requires:
- Publisher to provide a "forwarding" URL at bot submission
- AdsGalaxy to forward raw Telegram Update objects
- Retry/error handling for forward failures
- Replay protection (to avoid duplicate-sending same update twice if forward fails)
- Coordination with integration endpoint (both receive /start?)

---

## PART 4: AUDIT OF PROPOSED INTERMEDIARY MODEL

### Proposed Model

```
Telegram Update (e.g., /start from user 12345)
↓
AdsGalaxy Webhook {api.adsgalaxy.com/telegram/bots/{botId}}
↓
AdsGalaxy:
  1. Extract user from update
  2. Store in bot_users (source='webhook')
  3. Forward to publisher backend
↓
Publisher Backend {publisher.example.com/telegram/bot/webhook}
↓
Publisher's own bot logic continues
```

### Technical Feasibility Analysis

#### 1. Webhook Reception
**Feasibility:** ✓ POSSIBLE
- Telegram requires `setWebhook` call per bot (currently not done)
- Would require additional API route (e.g., `POST /api/telegram/bots/{botId}`)
- Telegram's secret token verification already implemented for channel webhook (`src/app/api/webhook/telegram/route.ts:5-14`)
- Could extend this pattern

#### 2. User Extraction & Storage
**Feasibility:** ✓ POSSIBLE
- Extract `message.from.id`, `message.from.username`, `message.from.first_name` from Telegram Update
- Code already exists in integration endpoint (line 127-137 of bot/integration route)
- Source would be `'webhook'` or `'telegram_direct'`

#### 3. Forward to Publisher
**Feasibility:** ⚠ RISKY - Requires architectural decisions
- Must know publisher's forwarding URL (not currently stored)
- Must serialize Telegram Update object (what format? raw JSON? wrapped?)
- Must validate URL (prevent SSRF attacks on private networks)
- Must handle forwarding failures:
  - Retry logic (how many times? backoff?)
  - Timeout (current integration endpoint: 8 seconds max, line 163 of test-integration)
  - Update loss (if forward fails, did user get stored? will publisher never see update?)

#### 4. Duplicate Update Prevention
**Feasibility:** ⚠ RISKY - Complex state management
- **Scenario A:** Forward succeeds, publisher calls integration endpoint with same user
  - Would update `duplicate_start_count` (already implemented line 154)
  - Acceptable
  
- **Scenario B:** Forward fails, publisher doesn't get update, doesn't call endpoint
  - User stored in AdsGalaxy but never reaches publisher
  - Publisher never sends Telegram response (e.g., welcome message)
  - Unrecoverable

- **Scenario C:** Forward fails mid-transmission, publisher receives partial update
  - Publisher sends integration endpoint call
  - AdsGalaxy sees it as duplicate
  - User processed twice locally, once by AdsGalaxy, once by publisher
  - Acceptable but creates confusion in logs

#### 5. Race Condition: Parallel /start Delivery
**Scenario:** User sends /start twice rapidly
```
Telegram /start #1 → AdsGalaxy webhook [received] → store user → forward to publisher
Telegram /start #2 → AdsGalaxy webhook [received] → check duplicate → skip or update

Publisher receives forwarded #1 → processes bot logic → calls integration endpoint
Telegram sees #2 still in flight → retry? or discard?
```
**Risk:** Duplicate processing if both webhook and integration endpoint fire

---

### Safety Assessment: Is This Safe?

**ANSWER: HIGH RISK - Not recommended without additional safeguards**

#### Key Risks

| Risk | Severity | Details |
|------|----------|---------|
| Webhook Replacement | CRITICAL | Setting AdsGalaxy webhook deletes publisher's webhook. If AdsGalaxy service dies, publisher loses all Telegram updates. |
| Forward Delivery Failure | HIGH | If forward to publisher fails, user is stored in AdsGalaxy but publisher never sees /start. No automatic recovery. |
| Update Duplication | MEDIUM | If publisher calls integration endpoint while webhook forwarding is in-flight, user might be processed twice. |
| Publisher Webhook URL Storage | MEDIUM | Requires storing publisher's backend URL in database. Must validate to prevent SSRF. |
| Forward Timeout Handling | MEDIUM | If forward takes >8s, what happens? Retry? Give up? User already stored? |
| Integration Secret Rotation | MEDIUM | If AdsGalaxy webhook URL changes (IP/domain), requires calling Telegram setWebhook again. |
| Concurrent /start Events | LOW | Unlikely at scale but possible. Request ordering not guaranteed. |

#### Additional Complexity Required

1. **Schema Changes**
   - Add `webhook_forwarding_url` column to `bots` table
   - Add `webhook_secret` (optional, for publisher to verify forwarding source)
   - Possibly add `forwarding_failure_reason`, `forwarding_last_attempted_at`

2. **New Routes**
   - `POST /api/telegram/bots/{botId}` - receive Telegram updates
   - `PUT /api/publisher/bots/{id}/webhook-forwarding` - configure forwarding URL

3. **Logic**
   - `setWebhook` call at bot approval time (currently no webhook setup done)
   - Forward logic with retry (exponential backoff?)
   - Webhook signature verification (Telegram includes secret token header)
   - Error logging and alerting if forwards consistently fail

4. **Operator Burden**
   - Must monitor AdsGalaxy webhook availability
   - If AdsGalaxy service down, all bot users lose /start updates (critical)
   - Must verify publisher's forwarding URLs are reachable and won't change

---

### Alternative: Keep Current Pull Model

**Why Current Model is Safer:**

| Aspect | Pull Model | Proposed Push Model |
|--------|-----------|-------------------|
| Webhook Management | Publisher controls (simple) | AdsGalaxy controls (critical) |
| Failure Impact | Partial (user not recorded) | Severe (Telegram updates lost) |
| Publisher Integration | Explicit (clear ownership) | Implicit (hidden forward dependency) |
| Debugging | Clear request/response logs | Request succeeds but forward fails invisibly |
| Scalability | Simple HTTP call | HTTP forward + retry logic |
| Service Coupling | Loose (publisher can delay) | Tight (AdsGalaxy availability critical) |

---

## PART 5: CURRENT STATE VERIFICATION

### What Currently Works ✓

1. ✓ Publisher can submit bot token
2. ✓ AdsGalaxy generates integration URL  
3. ✓ Publisher can send user data to integration endpoint
4. ✓ User stored with `source='integration'`, `status='active'`
5. ✓ Duplicate /start prevention via request_id_hash
6. ✓ Bot health checks (getMe, getChatMember)
7. ✓ Manual admin user import
8. ✓ Test integration endpoint (line 146-171 of test-integration route)

### What Does NOT Work ✗

1. ✗ Automatic /start capture without publisher integration
2. ✗ Direct Telegram webhook (disabled, returns 410)
3. ✗ Forwarding of Telegram updates to publisher
4. ✗ User capture before publisher implements integration
5. ✗ Capturing /start from bots using polling (no interception)

### What Requires Publisher Code ⚠

For bot monetization to work, publisher MUST:
1. Receive bot token generation from their own /start handler
2. Call `https://adsgalaxy.app/api/bot/integration/{botId}/{secret}` with user details
3. Handle the integration_url (parse from response or retrieve from GET `/api/publisher/bots/{id}`)
4. Call it EVERY TIME a user starts the bot

---

## PART 6: PRODUCT EXPECTATION VS. REALITY

### Stated Expectation

> "When a publisher submits a Telegram bot token for Bot Monetization, AdsGalaxy should collect that bot's users when they send `/start`, even before the publisher completes the AdsGalaxy integration."

### Reality

**The publisher MUST complete the integration.** Specifically, they must:
1. Parse the integration_url from the bot submission response
2. Integrate it into their bot's /start handler
3. Call it with the user's Telegram ID and details

**Without this, AdsGalaxy has no way to know:**
- When a user sends /start
- Which user sent /start
- Any information about the user

### Gap Analysis

| Expectation | Current State |
|-------------|---------------|
| "collect users when they send /start" | Requires publisher's callback via integration endpoint |
| "even before publisher completes integration" | Impossible - requires integration by definition |
| "without AdsGalaxy accessing bot token" | Safe ✓ (token only used for health checks) |
| "preserve bot logic on publisher side" | Yes ✓ (publisher handles bot normally) |

**Verdict:** Expectation fundamentally mismatches architecture.

---

## PART 7: PROTECTED LOGIC (DO NOT MODIFY)

✓ Bot token encryption/decryption  
✓ Bot ownership verification  
✓ Integration secret generation and verification  
✓ Bot health checks (getMe, getChatMember, getChat)  
✓ Bot approval/rejection/deletion workflows  
✓ Duplicate detection (request_id_hash)  
✓ Integration event audit logging  
✓ User status lifecycle (pending_verification → active)  
✓ Broadcast delivery and settlement calculations  

---

## PART 8: FILES REQUIRING NO MODIFICATION

The current implementation is architecturally sound FOR THE PULL MODEL. The following files should remain unchanged:

- `src/lib/botIntegration.ts` (secret generation, encryption)
- `src/app/api/bot/integration/[botId]/[secret]/route.ts` (user recording)
- `src/app/api/publisher/bots/route.ts` (bot submission)
- `src/lib/botAudience.ts` (user counting)
- `src/app/api/publisher/bots/[id]/test-integration/route.ts` (diagnostics)

---

## PART 9: REGRESSION RISKS IF MODIFIED

### Risk 1: Enabling Direct Telegram Webhook
**If:** AdsGalaxy calls `setWebhook` during bot approval
**Risk:** 
- Deletes publisher's existing webhook
- If AdsGalaxy service down, all updates lost
- Updates sent to AdsGalaxy, not publisher
- Publisher must wait for AdsGalaxy to forward

### Risk 2: Making Integration Optional
**If:** User recording auto-triggered by /start (hypothetical future)
**Risk:**
- Violates separation of concerns
- Telegram updates become AdsGalaxy's responsibility
- Service reliability directly impacts publisher

### Risk 3: Removing Integration Endpoint
**If:** Removed or deprecated
**Risk:**
- Publishers who already integrated would break
- Backward compatibility lost
- No way to submit user data

---

## SUMMARY TABLE: USER ACQUISITION PATHS

| # | Path | Type | Trigger | User Source | Status | Broadcast-Eligible | Requires Publisher | Auto-/start |
|---|------|------|---------|-------------|--------|-------------------|------------------|----------|
| 1 | Publisher Integration Endpoint | Pull (callback) | Publisher calls URL | `integration` | `active` | ✓ Yes | ✓ Yes | ❌ No |
| 2 | Manual Admin Import | Admin action | Admin provides IDs | `manual_admin` | `pending_verification` | ❌ No | N/A | ❌ No |
| 3 | ~~Legacy Bot Webhook~~ | ~~Push~~ | ~~Telegram~~ | ~~`webhook`~~ | ~~`active`~~ | ~~✓ Yes~~ | ~~❌ No~~ | ~~✓ Yes~~ |
| 4 | Broadcast Attribution | N/A | N/A (post-delivery) | Implicit | As recorded | Existing only | N/A | N/A |

---

## CONCLUSION

### Current Architecture Summary

**Model:** Publisher-Driven Pull (Callback)

```
Publisher Bot
├─ Publisher receives /start from Telegram
├─ Publisher's logic processes /start
└─ Publisher calls AdsGalaxy integration URL
   └─ AdsGalaxy records user
   └─ AdsGalaxy cannot intervene or intercept
```

**NOT:**

```
Telegram
├─ Telegram sends /start to AdsGalaxy webhook
├─ AdsGalaxy records user
├─ AdsGalaxy forwards to publisher
└─ Publisher's logic processes /start
```

### Feasibility Assessment

**Q: Is the proposed intermediary model (direct /start capture) possible?**  
**A:** Technically yes, but high-risk and requires architectural overhaul.

**Q: Is it safe?**  
**A:** No. Risk of data loss during forward failures exceeds benefits of auto-capture.

**Q: Can both publisher webhook and AdsGalaxy webhook coexist?**  
**A:** No. Telegram allows one webhook per bot. Setting new webhook deletes previous.

**Q: What would be required?**  
A:
1. New database columns for publisher's forwarding URL
2. `setWebhook` call at bot approval time
3. Telegram update receipt and parsing
4. Forward-to-publisher logic with retry/backoff
5. Error handling and alerting
6. Webhook signature verification
7. Comprehensive testing for failure scenarios

---

## FINAL READINESS ASSESSMENT

### Is the current implementation safe and working?

**YES, FOR THE PULL MODEL.** The current code is:
- ✓ Correctly implements publisher callback integration
- ✓ Securely manages secrets (encryption, HMAC)
- ✓ Prevents duplicates (request_id_hash + SELECT FOR UPDATE)
- ✓ Properly audits events
- ✓ Handles both new and existing users

### Is the proposed push model implementable?

**YES, but would require:**
1. New schema (forwarding_url column)
2. New routes (POST /api/telegram/bots/{botId})
3. Retry logic with backoff
4. Comprehensive failure handling
5. Significant testing

### Is the proposed push model recommended?

**NOT WITHOUT:**
1. Explicit publisher opt-in (not default)
2. Fallback to pull model if forwarding fails
3. Monitoring/alerting for forward failures
4. Rate limiting to prevent DDOS-on-forward
5. Timeout tuning (current 8s may be too short for flaky networks)

---

## B. "Not ready for Codex"

**Unresolved Dependencies:**

1. **Product Decision:** Should the system attempt direct /start capture, or remain publisher-driven?
2. **Architecture Decision:** If capture is desired, accept high-risk push model or design safer alternative?
3. **Schema:** If forwarding needed, design bot_users/publisher_webhooks schema?
4. **Retry Policy:** If forwarding fails, retry logic specifics (backoff, max attempts, timeout)?
5. **Operator Readiness:** Can team monitor AdsGalaxy webhook availability 24/7?
6. **Backward Compatibility:** How to migrate existing integrations if switching models?

---

## End of Audit Report
