import React from "react";
import { cn } from "@/lib/utils";

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-100", className)} />;
}

export function SkeletonStatGrid({ count = 6, columns = "grid-cols-2 sm:grid-cols-3" }: { count?: number; columns?: string }) {
  return (
    <div className={cn("grid gap-2.5", columns)}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonBlock key={index} className="h-16" />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonBlock key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-3.5 w-1/2" />
          <SkeletonBlock className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonTableRows({ columns = 5, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className="px-5 py-4">
              <SkeletonBlock className="h-4 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonChart() {
  return (
    <div className="rounded-xl border border-slate-100 p-3.5">
      <SkeletonBlock className="mb-3 h-3 w-24" />
      <SkeletonBlock className="h-36 w-full" />
    </div>
  );
}
