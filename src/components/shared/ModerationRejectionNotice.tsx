"use client";
import { safeOpenExternalUrl } from "@/lib/telegramExternalLink";

export type ModerationRejectionSummary = { public_rule_number: number; policy_name: string; policy_url: string; rejected_at?: string };
export default function ModerationRejectionNotice({ status, rejection, language = "en" }: { status?: string; rejection?: ModerationRejectionSummary | null; language?: string }) {
  if (String(status).toLowerCase() !== "rejected") return null;
  const ru = language === "ru";
  return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-bold">{ru ? "Отклонено" : "Rejected"}</p>{rejection ? <p className="mt-1">{ru ? "Причина отклонения" : "Rejection reason"}: <button type="button" onClick={() => safeOpenExternalUrl(rejection.policy_url)} className="font-semibold underline underline-offset-2">{ru ? "Правило" : "Rule"} {rejection.public_rule_number} {ru ? "политики" : "of"} {rejection.policy_name}</button></p> : <p className="mt-1">{ru ? "Отклонено в предыдущей системе модерации." : "Rejected under previous moderation system."}</p>}</div>;
}
