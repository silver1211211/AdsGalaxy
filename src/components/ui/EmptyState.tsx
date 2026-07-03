import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "default" | "compact";
  tone?: "slate" | "blue";
}

export default function EmptyState({
  icon: Icon,
  title,
  message,
  actionLabel,
  onAction,
  variant = "default",
  tone = "slate",
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const toneClasses = tone === "blue"
    ? { iconBg: "bg-blue-50", iconColor: "text-[#0c9de8]" }
    : { iconBg: "bg-slate-100", iconColor: "text-slate-400" };

  return (
    <div className={cn(
      "flex flex-col items-center justify-center text-center",
      isCompact ? "gap-2 rounded-xl bg-slate-50 px-4 py-6" : "gap-3 rounded-2xl border border-dashed border-slate-200 px-6 py-10",
    )}>
      <div className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl",
        isCompact ? "h-10 w-10" : "h-14 w-14",
        toneClasses.iconBg, toneClasses.iconColor,
      )}>
        <Icon size={isCompact ? 18 : 24} />
      </div>
      <div>
        <p className={cn("font-black text-slate-700", isCompact ? "text-xs" : "text-sm")}>{title}</p>
        <p className={cn("mt-1 max-w-xs font-medium leading-relaxed text-slate-400", isCompact ? "text-[11px]" : "text-xs")}>
          {message}
        </p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0c9de8] px-4 py-2.5 text-xs font-black text-white transition hover:bg-blue-600 active:scale-[0.98]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
