"use client";
import { useEffect, useState } from "react";
import { getPolicyDefinition, getPolicyRule } from "@/lib/policyRegistry";

type HistoryRow = { id: number; policy_rule_key: string; policy_scope: string; public_rule_number: number; policy_version: string; internal_note?: string | null; rejected_by_admin_id: number; rejected_at: string };
export default function ModerationHistory({ entityType, entityId }: { entityType: string; entityId: number | string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  useEffect(() => { const controller = new AbortController(); fetch(`/api/admin/moderation-rejections?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(String(entityId))}&limit=20`, { signal: controller.signal }).then((response) => response.ok ? response.json() : { rejections: [] }).then((data) => setRows(Array.isArray(data.rejections) ? data.rejections : [])).catch(() => undefined); return () => controller.abort(); }, [entityId, entityType]);
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Moderation history</h4>{rows.length === 0 ? <p className="mt-2 text-xs text-slate-500">No structured rejection history. Legacy rejected records are not backfilled.</p> : <ol className="mt-3 space-y-2">{rows.map((row) => { const rule = getPolicyRule(row.policy_rule_key); return <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs"><p className="font-bold text-slate-900">Rule {row.public_rule_number} · {rule?.admin_label || row.policy_rule_key}</p><p className="mt-1 text-slate-500">{getPolicyDefinition(row.policy_scope as never)?.name || row.policy_scope} · {row.policy_version} · {new Date(row.rejected_at).toLocaleString()}</p>{row.internal_note && <p className="mt-2 whitespace-pre-wrap text-slate-700">Internal: {row.internal_note}</p>}</li>; })}</ol>}</section>;
}
