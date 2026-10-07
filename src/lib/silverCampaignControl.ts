import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { acquireCronLock, releaseCronLock } from "@/lib/cronSecurity";
import crypto from "crypto";
import { cookies } from "next/headers";
import { deleteCampaignPostsByIds } from "@/lib/campaignPostDeletion";
import { allocateCampaignPublicId } from "@/lib/campaignIdentity";

export type CampaignManagementScope = "main" | "silver";
type Db = Pool | PoolConnection;

export function mainCampaignScopeSql(alias = "c") {
  return `NOT EXISTS (SELECT 1 FROM campaign_admin_isolation cai WHERE cai.campaign_id=${alias}.id AND cai.management_scope='silver')`;
}

export function mainCampaignDisplayNumberSql(alias = "c") {
  return `COALESCE(${alias}.public_id,(SELECT COUNT(*) FROM campaigns mc WHERE mc.id<=${alias}.id AND ${mainCampaignScopeSql("mc")}))`;
}

export function silverCampaignScopeSql(alias = "c") {
  return `EXISTS (SELECT 1 FROM campaign_admin_isolation cai WHERE cai.campaign_id=${alias}.id AND cai.management_scope='silver')`;
}

export function silverCampaignDeliverySql(alias = "c") {
  return `(${mainCampaignScopeSql(alias)} OR EXISTS (SELECT 1 FROM campaign_admin_isolation cai JOIN settings ss ON ss.\`key\`='silver_delivery_enabled' AND LOWER(ss.value)='true' WHERE cai.campaign_id=${alias}.id AND cai.management_scope='silver'))`;
}

export function silverChannelEligibilitySql(
  campaignAlias = "c",
  channelAlias = "ch",
) {
  return `NOT EXISTS (SELECT 1 FROM campaign_admin_isolation cai JOIN silver_ad_exempt_users seu ON seu.user_id=${channelAlias}.user_id AND seu.active=1 WHERE cai.campaign_id=${campaignAlias}.id AND cai.management_scope='silver')`;
}

export async function getCampaignManagementScope(
  campaignId: number,
  db: Db = pool,
): Promise<CampaignManagementScope | null> {
  const [rows] = await db.query<
    Array<
      RowDataPacket & {
        id: number;
        management_scope: CampaignManagementScope | null;
      }
    >
  >(
    `SELECT c.id,cai.management_scope FROM campaigns c LEFT JOIN campaign_admin_isolation cai ON cai.campaign_id=c.id AND cai.management_scope='silver' WHERE c.id=? LIMIT 1`,
    [campaignId],
  );
  if (!rows[0]) return null;
  return rows[0].management_scope === "silver" ? "silver" : "main";
}

export async function campaignBelongsToScope(
  campaignId: number,
  scope: CampaignManagementScope,
  db: Db = pool,
) {
  return (await getCampaignManagementScope(campaignId, db)) === scope;
}

function silverSessionSecret() {
  const secret =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Silver session secret is not configured");
  return secret;
}

function signSilverSession(payload: string) {
  return crypto
    .createHmac("sha256", silverSessionSecret())
    .update(`silver.${payload}`)
    .digest("hex");
}

export function createSilverSessionCookieValue(
  adminId: number,
  expiresAt: number,
) {
  const payload = Buffer.from(
    JSON.stringify({ adminId, expiresAt }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signSilverSession(payload)}`;
}

export async function hasSilverSession(adminId: number) {
  const value = (await cookies()).get("silver_auth")?.value || "";
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(signSilverSession(payload), "hex");
  const supplied = Buffer.from(signature, "hex");
  if (
    expected.length !== supplied.length ||
    !crypto.timingSafeEqual(expected, supplied)
  )
    return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { adminId?: unknown; expiresAt?: unknown };
    return (
      Number(parsed.adminId) === adminId &&
      Number(parsed.expiresAt) > Date.now()
    );
  } catch {
    return false;
  }
}

export async function requireSilverAccessAdmin() {
  const admin = await getAuthenticatedAdmin();
  if (!admin)
    return {
      admin: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  const [rows] = await pool.query<Array<RowDataPacket & { active: number }>>(
    "SELECT active FROM silver_admin_access WHERE admin_id=? AND active=1 LIMIT 1",
    [admin.id],
  );
  if (!rows[0])
    return {
      admin,
      response: Response.json(
        { error: "Silver campaign permission required" },
        { status: 403 },
      ),
    };
  return { admin, response: null };
}

export async function requireSilverAdmin() {
  const access = await requireSilverAccessAdmin();
  if (access.response || !access.admin) return access;
  if (!(await hasSilverSession(access.admin.id))) {
    return {
      admin: access.admin,
      response: Response.json(
        { error: "Silver password required" },
        { status: 401 },
      ),
    };
  }
  return access;
}

export async function recordSilverAudit(input: {
  adminId?: number | null;
  action: string;
  campaignId?: number | null;
  targetUserId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    "INSERT INTO silver_admin_audit_events(admin_id,action,campaign_id,target_user_id,metadata) VALUES(?,?,?,?,?)",
    [
      input.adminId || null,
      input.action,
      input.campaignId || null,
      input.targetUserId || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
}

export function reportSilverApiError(context: string, error: unknown) {
  console.error(`[Silver Admin] ${context}`, error);
}

export async function sanitizeSilverApiResponse(
  response: Response,
  fallbackMessage: string,
) {
  if (response.status < 500) return response;
  let details: unknown = null;
  try {
    details = await response.clone().json();
  } catch {
    details = { status: response.status, statusText: response.statusText };
  }
  reportSilverApiError(fallbackMessage, details);
  return Response.json({ error: fallbackMessage }, { status: response.status });
}

export async function handleSilverApiRequest(
  operation: () => Promise<Response>,
  fallbackMessage: string,
) {
  try {
    return await sanitizeSilverApiResponse(await operation(), fallbackMessage);
  } catch (error) {
    reportSilverApiError(fallbackMessage, error);
    return Response.json({ error: fallbackMessage }, { status: 500 });
  }
}

async function blockFutureExemptAllocations(
  conn: PoolConnection,
  campaignId: number,
) {
  const [result] = await conn.query(
    `UPDATE campaign_posts cp JOIN channels ch ON ch.id=cp.channel_id JOIN silver_ad_exempt_users seu ON seu.user_id=ch.user_id AND seu.active=1
     SET cp.status='delivery_failed',cp.delivery_failed_at=COALESCE(cp.delivery_failed_at,NOW()),cp.delivery_failure_reason='silver_exempt_publisher'
     WHERE cp.campaign_id=? AND cp.message_id IS NULL AND cp.status IN ('pending','pending_delivery','queued','scheduled')`,
    [campaignId],
  );
  return Number((result as { affectedRows?: number }).affectedRows || 0);
}

export async function pullMainCampaignNumberToSilver(
  mainDisplayNumber: number,
  adminId: number,
) {
  const numberingLock = await acquireCronLock("campaign-main-numbering", 600);
  if (!numberingLock) throw new Error("CAMPAIGN_LIST_CHANGED");
  const conn = await pool.getConnection();
  let campaignLock: Awaited<ReturnType<typeof acquireCronLock>> = null;
  let cleanupPostIds: number[] = [];
  try {
    await conn.beginTransaction();
    const [resolved] = await conn.query<Array<RowDataPacket & { id: number }>>(
      `SELECT numbered.id
       FROM (
         SELECT c.id,${mainCampaignDisplayNumberSql("c")} main_display_number
         FROM campaigns c
         WHERE ${mainCampaignScopeSql("c")}
       ) numbered
       WHERE numbered.main_display_number=?
       LIMIT 1`,
      [mainDisplayNumber],
    );
    const campaignId = Number(resolved[0]?.id || 0);
    if (!campaignId) throw new Error("MAIN_CAMPAIGN_NUMBER_UNAVAILABLE");

    campaignLock = await acquireCronLock(
      `campaign-management-${campaignId}`,
      600,
    );
    if (!campaignLock) throw new Error("CAMPAIGN_MANAGEMENT_BUSY");

    const [campaigns] = await conn.query<
      Array<
        RowDataPacket & {
          id: number;
          status: string;
          budget: string;
          channel_spend: string;
        }
      >
    >(
      "SELECT id,status,budget,channel_spend FROM campaigns WHERE id=? FOR UPDATE",
      [campaignId],
    );
    if (!campaigns[0]) throw new Error("CAMPAIGN_LIST_CHANGED");
    const [scopeRows] = await conn.query<
      Array<RowDataPacket & { management_scope: string }>
    >(
      "SELECT management_scope FROM campaign_admin_isolation WHERE campaign_id=? FOR UPDATE",
      [campaignId],
    );
    if (scopeRows[0]?.management_scope === "silver")
      throw new Error("CAMPAIGN_LIST_CHANGED");

    const [recheck] = await conn.query<
      Array<RowDataPacket & { main_display_number: number }>
    >(
      `SELECT ${mainCampaignDisplayNumberSql("c")} main_display_number
       FROM campaigns c
       WHERE c.id=? AND ${mainCampaignScopeSql("c")}
       LIMIT 1`,
      [campaignId],
    );
    if (Number(recheck[0]?.main_display_number || 0) !== mainDisplayNumber) {
      throw new Error("CAMPAIGN_LIST_CHANGED");
    }

    await conn.query(
      "INSERT INTO campaign_admin_isolation(campaign_id,management_scope,pulled_at,pulled_by,released_at) VALUES(?,'silver',NOW(),?,NULL) ON DUPLICATE KEY UPDATE management_scope='silver',pulled_at=NOW(),pulled_by=VALUES(pulled_by),released_at=NULL",
      [campaignId, adminId],
    );
    const blocked = await blockFutureExemptAllocations(conn, campaignId);
    const [cleanupRows] = await conn.query<Array<RowDataPacket & { id: number }>>(
      `SELECT cp.id
       FROM campaign_posts cp
       JOIN channels ch ON ch.id=cp.channel_id
       JOIN silver_ad_exempt_users seu ON seu.user_id=ch.user_id AND seu.active=1
       WHERE cp.campaign_id=?
         AND cp.message_id IS NOT NULL
         AND cp.status IN ('active','posted','sent','delete_failed','cleanup_pending')
       FOR UPDATE`,
      [campaignId],
    );
    cleanupPostIds = cleanupRows.map(row => Number(row.id));
    await conn.query(
      "INSERT INTO silver_admin_audit_events(admin_id,action,campaign_id,metadata) VALUES(?,'campaign_pull',?,?)",
      [
        adminId,
        campaignId,
        JSON.stringify({
          pulled_from_main_display_number: mainDisplayNumber,
          permanent_real_campaign_id: campaignId,
          future_allocations_blocked: blocked,
        }),
      ],
    );
    await conn.commit();
    let cleanup = null;
    if (cleanupPostIds.length) {
      try {
        cleanup = await deleteCampaignPostsByIds(cleanupPostIds, { requiredSilverExemptUserId: true });
        await pool.query(
          "INSERT INTO silver_admin_audit_events(admin_id,action,campaign_id,metadata) VALUES(?,'campaign_pull_exempt_cleanup',?,?)",
          [adminId, campaignId, JSON.stringify(cleanup)],
        );
      } catch (cleanupError) {
        console.error("Silver exempt post cleanup failed after campaign pull", {
          campaignId,
          postCount: cleanupPostIds.length,
          error: cleanupError instanceof Error ? cleanupError.message : "cleanup_failed",
        });
      }
    }
    return {
      campaignId,
      mainDisplayNumber,
      futureAllocationsBlocked: blocked,
      exemptActivePostsSelected: cleanupPostIds.length,
      cleanup,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await releaseCronLock(campaignLock);
    await releaseCronLock(numberingLock);
  }
}

export async function releaseCampaignToMain(
  campaignId: number,
  adminId: number,
) {
  const numberingLock = await acquireCronLock("campaign-main-numbering", 600);
  if (!numberingLock) throw new Error("CAMPAIGN_LIST_CHANGED");
  const campaignLock = await acquireCronLock(
    `campaign-management-${campaignId}`,
    600,
  );
  if (!campaignLock) {
    await releaseCronLock(numberingLock);
    throw new Error("CAMPAIGN_MANAGEMENT_BUSY");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [campaigns] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM campaigns WHERE id=? FOR UPDATE",
      [campaignId],
    );
    if (!campaigns[0]) throw new Error("CAMPAIGN_NOT_FOUND");
    const [result] = await conn.query(
      "DELETE FROM campaign_admin_isolation WHERE campaign_id=? AND management_scope='silver'",
      [campaignId],
    );
    if (Number((result as { affectedRows?: number }).affectedRows || 0) !== 1)
      throw new Error("CAMPAIGN_NOT_SILVER");
    const [[identity]] = await conn.query<Array<RowDataPacket & { public_id: number | null }>>(
      "SELECT public_id FROM campaigns WHERE id=?",
      [campaignId],
    );
    const publicId = identity?.public_id || await allocateCampaignPublicId(conn, campaignId);
    await conn.query(
      "INSERT INTO silver_admin_audit_events(admin_id,action,campaign_id,metadata) VALUES(?,'campaign_release',?,?)",
      [
        adminId,
        campaignId,
        JSON.stringify({ preserved_real_campaign_id: campaignId, public_campaign_id: publicId }),
      ],
    );
    await conn.commit();
    return { campaignId, publicId };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await releaseCronLock(campaignLock);
    await releaseCronLock(numberingLock);
  }
}

export async function isChannelAllowedForCampaign(
  campaignId: number,
  channelId: number,
  db: Db = pool,
) {
  const [rows] = await db.query<
    Array<RowDataPacket & { allowed: number; reason: string | null }>
  >(
    `SELECT CASE
       WHEN cai.campaign_id IS NULL THEN 1
       WHEN LOWER(COALESCE(ss.value,'true'))<>'true' THEN 0
       WHEN seu.user_id IS NOT NULL THEN 0 ELSE 1 END allowed,
       CASE WHEN cai.campaign_id IS NULL THEN NULL WHEN LOWER(COALESCE(ss.value,'true'))<>'true' THEN 'silver_delivery_paused' WHEN seu.user_id IS NOT NULL THEN 'silver_exempt_publisher' ELSE NULL END reason
     FROM campaigns c JOIN channels ch ON ch.id=?
     LEFT JOIN campaign_admin_isolation cai ON cai.campaign_id=c.id AND cai.management_scope='silver'
     LEFT JOIN silver_ad_exempt_users seu ON seu.user_id=ch.user_id AND seu.active=1
     LEFT JOIN settings ss ON ss.\`key\`='silver_delivery_enabled'
     WHERE c.id=? LIMIT 1`,
    [channelId, campaignId],
  );
  return {
    allowed: Number(rows[0]?.allowed || 0) === 1,
    reason: rows[0]?.reason || "campaign_or_channel_missing",
  };
}

export async function isCampaignDeliveryAllowed(
  campaignId: number,
  db: Db = pool,
) {
  const [rows] = await db.query<
    Array<RowDataPacket & { allowed: number; reason: string | null }>
  >(
    `SELECT CASE
       WHEN cai.campaign_id IS NULL THEN 1
       WHEN LOWER(COALESCE(ss.value,'true'))='true' THEN 1 ELSE 0 END allowed,
       CASE WHEN cai.campaign_id IS NOT NULL AND LOWER(COALESCE(ss.value,'true'))<>'true' THEN 'silver_delivery_paused' ELSE NULL END reason
     FROM campaigns c
     LEFT JOIN campaign_admin_isolation cai ON cai.campaign_id=c.id AND cai.management_scope='silver'
     LEFT JOIN settings ss ON ss.\`key\`='silver_delivery_enabled'
     WHERE c.id=? LIMIT 1`,
    [campaignId],
  );
  return {
    allowed: Number(rows[0]?.allowed || 0) === 1,
    reason: rows[0]?.reason || "campaign_missing",
  };
}

export async function addSilverExemptUser(
  userId: number,
  adminId: number,
  reason: string,
) {
  const conn = await pool.getConnection();
  let cleanupPostIds: number[] = [];
  try {
    await conn.beginTransaction();
    const [users] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE id=? FOR UPDATE",
      [userId],
    );
    if (!users[0]) throw new Error("USER_NOT_FOUND");
    await conn.query(
      "INSERT INTO silver_ad_exempt_users(user_id,active,reason,created_by) VALUES(?,1,?,?) ON DUPLICATE KEY UPDATE active=1,reason=VALUES(reason),created_by=VALUES(created_by)",
      [userId, reason || null, adminId],
    );
    const [result] = await conn.query(
      `UPDATE campaign_posts cp JOIN channels ch ON ch.id=cp.channel_id JOIN campaign_admin_isolation cai ON cai.campaign_id=cp.campaign_id AND cai.management_scope='silver'
       SET cp.status='delivery_failed',cp.delivery_failed_at=COALESCE(cp.delivery_failed_at,NOW()),cp.delivery_failure_reason='silver_exempt_publisher'
       WHERE ch.user_id=? AND cp.message_id IS NULL AND cp.status IN ('pending','pending_delivery','queued','scheduled')`,
      [userId],
    );
    const blocked = Number(
      (result as { affectedRows?: number }).affectedRows || 0,
    );
    const [cleanupRows] = await conn.query<Array<RowDataPacket & { id: number }>>(
      `SELECT cp.id
       FROM campaign_posts cp
       JOIN channels ch ON ch.id=cp.channel_id
       JOIN campaign_admin_isolation cai ON cai.campaign_id=cp.campaign_id AND cai.management_scope='silver'
       WHERE ch.user_id=?
         AND cp.message_id IS NOT NULL
         AND cp.status IN ('active','posted','sent','delete_failed','cleanup_pending')
       FOR UPDATE`,
      [userId],
    );
    cleanupPostIds = cleanupRows.map(row => Number(row.id));
    await conn.query(
      "INSERT INTO silver_admin_audit_events(admin_id,action,target_user_id,metadata) VALUES(?,'exempt_user_add',?,?)",
      [
        adminId,
        userId,
        JSON.stringify({ future_allocations_blocked: blocked }),
      ],
    );
    await conn.commit();
    let cleanup = null;
    if (cleanupPostIds.length) {
      try {
        cleanup = await deleteCampaignPostsByIds(cleanupPostIds, { requiredSilverExemptUserId: userId });
        await pool.query(
          "INSERT INTO silver_admin_audit_events(admin_id,action,target_user_id,metadata) VALUES(?,'exempt_user_active_post_cleanup',?,?)",
          [adminId, userId, JSON.stringify(cleanup)],
        );
      } catch (cleanupError) {
        console.error("Silver exempt post cleanup failed after exemption activation", {
          userId,
          postCount: cleanupPostIds.length,
          error: cleanupError instanceof Error ? cleanupError.message : "cleanup_failed",
        });
      }
    }
    return {
      userId,
      futureAllocationsBlocked: blocked,
      activePostsSelected: cleanupPostIds.length,
      cleanup,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
