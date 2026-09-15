import { cn } from "@/lib/utils";

export function campaignStatusPresentation(status?: string, reason?: string | null) {
  if (reason === "insufficient_balance") return { label: "Insufficient Balance", helper: "Add funds to your Ad Balance to continue.", tone: "bg-amber-50 text-amber-800 ring-amber-200" };
  if (reason === "budget_exhausted" || status === "budget_exhausted") return { label: "Budget Exhausted", helper: "This campaign has reached its spending limit.", tone: "bg-orange-50 text-orange-800 ring-orange-200" };
  const map: Record<string, { label: string; helper: string; tone: string }> = {
    active: { label: "Active", helper: "Campaign delivery is running.", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    approved: { label: "Active", helper: "Campaign delivery is running.", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    paused: { label: "Paused", helper: "This campaign is paused.", tone: "bg-slate-100 text-slate-700 ring-slate-200" },
    completed: { label: "Completed", helper: "Campaign delivery has finished.", tone: "bg-blue-50 text-blue-700 ring-blue-200" },
    pending: { label: "Pending Review", helper: "Your campaign is being reviewed.", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
    rejected: { label: "Rejected", helper: "Review the campaign feedback before editing.", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
    scheduled: { label: "Scheduled", helper: "Campaign delivery will begin on schedule.", tone: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  };
  return map[String(status || "").toLowerCase()] || { label: "Draft", helper: "Campaign is not running.", tone: "bg-slate-100 text-slate-700 ring-slate-200" };
}

export default function CampaignStatusBadge({ status, reason }: { status?: string; reason?: string | null }) {
  const presentation = campaignStatusPresentation(status, reason);
  return <span title={presentation.helper} className={cn("inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset", presentation.tone)}>{presentation.label}</span>;
}
