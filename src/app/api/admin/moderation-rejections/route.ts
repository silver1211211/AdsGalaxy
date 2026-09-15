import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import { listModerationHistory, moderationNotificationHtml, ModerationError, rejectEntityWithPolicy } from "@/lib/moderationRejections";
import { sendTelegramMessage } from "@/lib/telegram";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

function failure(error: unknown) {
  if (error instanceof ModerationError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status });
  console.error("Structured moderation rejection failed", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}
function authFailure(response: Response) {
  const code = response.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
  return NextResponse.json({ error: code, code }, { status: response.status });
}

export async function GET(request: Request) {
  const { response } = await requireAdminPermission("read"); if (response) return authFailure(response);
  try { const q = new URL(request.url).searchParams; return NextResponse.json({ rejections: await listModerationHistory(q.get("entity_type"), q.get("entity_id"), q.get("page"), q.get("limit")) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const { admin, response } = await requireAdminPermission("operate"); if (response) return authFailure(response);
  try {
    const body = await request.json().catch(() => ({}));
    const result = await rejectEntityWithPolicy({ entityType: body.entity_type, entityId: body.entity_id, ruleKey: body.policy_rule_key, internalNote: body.internal_note, publicRuleNumber: body.public_rule_number, adminId: Number(admin.id) });
    try { if (result.entity.telegram_id) await sendTelegramMessage(String(result.entity.telegram_id), moderationNotificationHtml(String(body.entity_type).includes("campaign") ? "advertiser" : "publisher", result.entity.entity_name, result.rule), { parse_mode: "HTML" }); } catch { /* rejection is committed; delivery is best effort */ }
    await recordAdminActionAudit({ adminId: Number(admin.id), action: "structured_moderation_reject", entityType: String(body.entity_type), entityId: Number(body.entity_id), reason: result.rule.rule_key, metadata: { rejection_id: result.id, policy_scope: result.rule.scope, policy_version: result.rule.policy_version } });
    return NextResponse.json({ success: true, rejection: { id: result.id, policy_rule_key: result.rule.rule_key, public_rule_number: result.rule.public_number, policy_version: result.rule.policy_version, policy_url: result.policy_url } });
  } catch (error) { return failure(error); }
}

// Compatibility for an already-open Admin client from before rejection requests
// were standardized on POST. Both methods execute the same authoritative flow.
export async function PATCH(request: Request) {
  return POST(request);
}
