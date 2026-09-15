"use client";

import type { ReactNode } from "react";
import { Check, ChevronLeft, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_STEPS = ["Campaign", "Creative", "Budget & Targeting"] as const;

export default function CampaignWizardShell({
  step,
  typeLabel,
  title,
  description,
  onBack,
  children,
  steps = DEFAULT_STEPS,
  icon,
}: {
  step: 1 | 2 | 3;
  typeLabel: string;
  title: string;
  description: string;
  onBack: () => void;
  children: ReactNode;
  steps?: readonly string[];
  icon?: ReactNode;
}) {
  const currentStep = steps[step - 1] || steps[0];
  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-4 overflow-hidden pb-[max(5rem,env(safe-area-inset-bottom))]">
      <header className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="rounded-[1.6rem] bg-[#020b20] p-5 text-white sm:p-7">
          <div className="flex min-w-0 items-center gap-4">
            <button type="button" onClick={onBack} aria-label="Back" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-slate-200 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-sky-400"><ChevronLeft size={18} /></button>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-slate-200">{icon || <Megaphone size={21} />}</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{typeLabel}</p>
              <h1 className="mt-1 break-words text-xl font-black tracking-tight sm:text-2xl">Step {step} of {steps.length} — {currentStep}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-400">{description || title}</p>
            </div>
          </div>
        </div>
        <ol aria-label="Campaign creation progress" className="mt-4 grid gap-2" style={{gridTemplateColumns:`repeat(${steps.length},minmax(0,1fr))`}}>
          {steps.map((label, index) => {
            const number = (index + 1) as 1 | 2 | 3;
            const complete = number < step;
            const active = number === step;
            return (
              <li key={label} aria-current={active ? "step" : undefined} className="min-w-0">
                <div className={cn("h-1 rounded-full", number <= step ? "bg-[#0c9de8]" : "bg-slate-200")} />
                <div className={cn("mt-2 flex items-center gap-1.5 text-[10px] font-bold sm:text-xs", active ? "text-slate-950" : complete ? "text-blue-700" : "text-slate-400")}>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", number <= step ? "bg-blue-50 text-blue-700" : "bg-slate-100")}>{complete ? <Check size={12} /> : number}</span>
                  <span className="truncate">{label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </header>
      {children}
    </div>
  );
}
