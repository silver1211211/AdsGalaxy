import "server-only";

const TIMEOUT_MS = 30_000;
const MAX_MESSAGE_LENGTH = 4_000;

export type GroupPilotMessage = { role: "USER" | "ASSISTANT"; content: string; createdAt?: string };
export type GroupPilotErrorCode = "RATE_LIMITED" | "DAILY_CAPACITY_REACHED" | "REQUEST_TOO_LARGE" | "INVALID_REQUEST" | "AI_TEMPORARILY_UNAVAILABLE" | "INTEGRATION_UNAVAILABLE";

export class GroupPilotError extends Error {
  constructor(public status: number, public code: GroupPilotErrorCode) { super(code); }
}

function config() {
  const apiUrl = process.env.GROUPPILOT_API_URL?.replace(/\/$/, "");
  const site = process.env.GROUPPILOT_SITE;
  const key = process.env.GROUPPILOT_KEY;
  if (!apiUrl || !site || !key) throw new GroupPilotError(503, "INTEGRATION_UNAVAILABLE");
  return { apiUrl, site, key };
}

function normalizeError(status: number, body: unknown) {
  const upstream = body && typeof body === "object" && "error" in body ? String((body as { error?: unknown }).error) : "";
  if (status === 429 && upstream === "DAILY_CAPACITY_REACHED") return new GroupPilotError(429, "DAILY_CAPACITY_REACHED");
  if (status === 429) return new GroupPilotError(429, "RATE_LIMITED");
  if (status === 413) return new GroupPilotError(413, "REQUEST_TOO_LARGE");
  if (status === 422) return new GroupPilotError(422, "INVALID_REQUEST");
  if (status === 503) return new GroupPilotError(503, "AI_TEMPORARILY_UNAVAILABLE");
  return new GroupPilotError(503, "INTEGRATION_UNAVAILABLE");
}

async function upstream(path: string, init: RequestInit, idempotencyKey?: string) {
  const { apiUrl, site, key } = config();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  headers.set("X-GroupPilot-Site", site);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try { response = await fetch(`${apiUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { if (attempt === 0) continue; throw new GroupPilotError(503, "AI_TEMPORARILY_UNAVAILABLE"); }
    const body: unknown = await response.json().catch(() => { throw new GroupPilotError(503, "INTEGRATION_UNAVAILABLE"); });
    if (response.ok) return body;
    if (response.status === 503 && attempt === 0) continue;
    throw normalizeError(response.status, body);
  }
  throw new GroupPilotError(503, "AI_TEMPORARILY_UNAVAILABLE");
}

export async function groupPilotRespond(input: { sessionId: string; userId: string; message: string; idempotencyKey: string }) {
  if (!input.message.trim() || input.message.length > MAX_MESSAGE_LENGTH) throw new GroupPilotError(input.message.length > MAX_MESSAGE_LENGTH ? 413 : 422, input.message.length > MAX_MESSAGE_LENGTH ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST");
  const payload = { sessionId: input.sessionId, userId: input.userId, message: input.message };
  const body = await upstream("/api/v1/ai/respond", { method: "POST", body: JSON.stringify(payload) }, input.idempotencyKey) as Record<string, unknown>;
  if (body.success !== true || typeof body.message !== "string" || !body.message.trim() || typeof body.requestId !== "string") throw new GroupPilotError(503, "INTEGRATION_UNAVAILABLE");
  return { success: true, requestId: body.requestId, action: String(body.action || "REPLY"), message: body.message };
}

export async function groupPilotGetConversation(sessionId: string) {
  const body = await upstream(`/api/v1/conversations/${encodeURIComponent(sessionId)}`, { method: "GET" }) as Record<string, unknown>;
  return { messages: Array.isArray(body.messages) ? body.messages.filter((item): item is GroupPilotMessage => Boolean(item && typeof item === "object" && typeof (item as GroupPilotMessage).content === "string" && ((item as GroupPilotMessage).role === "USER" || (item as GroupPilotMessage).role === "ASSISTANT"))) : [] };
}

export async function groupPilotClearConversation(sessionId: string) {
  await upstream(`/api/v1/conversations/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
