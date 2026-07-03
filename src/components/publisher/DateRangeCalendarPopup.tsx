"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type PresetKey = "today" | "yesterday" | "7d" | "30d" | "thisMonth" | "lastMonth";

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildMonthCells(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<{ dateKey: string; day: number } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push({ dateKey: toDateKey(year, month, day), day });
  return cells;
}

function resolvePreset(key: PresetKey): { start: string; end: string } {
  const now = new Date();
  const today = todayKey();
  if (key === "today") return { start: today, end: today };
  if (key === "yesterday") {
    const date = new Date(now); date.setDate(date.getDate() - 1);
    const key2 = date.toISOString().slice(0, 10);
    return { start: key2, end: key2 };
  }
  if (key === "7d") {
    const date = new Date(now); date.setDate(date.getDate() - 6);
    return { start: date.toISOString().slice(0, 10), end: today };
  }
  if (key === "30d") {
    const date = new Date(now); date.setDate(date.getDate() - 29);
    return { start: date.toISOString().slice(0, 10), end: today };
  }
  if (key === "thisMonth") {
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    return { start: start.toISOString().slice(0, 10), end: today };
  }
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function dayCount(start: string, end: string) {
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function formatDisplayDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

interface DateRangeCalendarPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (start: string, end: string) => void;
  initialStart?: string | null;
  initialEnd?: string | null;
}

export default function DateRangeCalendarPopup({ isOpen, onClose, onApply, initialStart, initialEnd }: DateRangeCalendarPopupProps) {
  const anchor = initialStart ? new Date(`${initialStart}T00:00:00Z`) : new Date();
  const [viewYear, setViewYear] = useState(anchor.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(anchor.getUTCMonth());
  const [pickerView, setPickerView] = useState<"days" | "months">("days");
  const [start, setStart] = useState<string | null>(initialStart ?? null);
  const [end, setEnd] = useState<string | null>(initialEnd ?? null);
  const maxKey = todayKey();

  function handleClose() {
    setPickerView("days");
    onClose();
  }

  function jumpTo(dateKey: string) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    setViewYear(date.getUTCFullYear());
    setViewMonth(date.getUTCMonth());
  }

  function handlePreset(key: PresetKey) {
    const range = resolvePreset(key);
    setStart(range.start);
    setEnd(range.end);
    jumpTo(range.end);
  }

  function handleDayClick(dateKey: string) {
    if (dateKey > maxKey) return;
    if (!start || (start && end)) {
      setStart(dateKey);
      setEnd(null);
      return;
    }
    if (dateKey < start) {
      setEnd(start);
      setStart(dateKey);
    } else {
      setEnd(dateKey);
    }
  }

  function changeMonth(delta: number) {
    let nextMonth = viewMonth + delta;
    let nextYear = viewYear;
    if (nextMonth < 0) { nextMonth = 11; nextYear -= 1; }
    if (nextMonth > 11) { nextMonth = 0; nextYear += 1; }
    setViewYear(nextYear);
    setViewMonth(nextMonth);
  }

  function handleApply() {
    if (!start) return;
    onApply(start, end ?? start);
  }

  const cells = buildMonthCells(viewYear, viewMonth);
  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(undefined, {
    month: "long", year: "numeric", timeZone: "UTC",
  });
  const activePreset = start && end ? PRESETS.find((preset) => {
    const range = resolvePreset(preset.key);
    return range.start === start && range.end === end;
  })?.key : undefined;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4" aria-modal="true" role="dialog">
          <motion.div
            key="calendar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            onClick={handleClose}
            aria-hidden="true"
          />

          <motion.div
            key="calendar-container"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="relative flex max-h-[88vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_rgba(15,23,42,0.16)]"
          >
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            >
              <X size={16} />
            </button>

            <div className="space-y-4 overflow-y-auto p-6">
              <div>
                <h3 className="pr-8 text-[17px] font-black leading-snug text-slate-900">Select Date Range</h3>
                <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                  Pick a quick range or tap custom dates below.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handlePreset(preset.key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1.5 text-[10px] font-black transition-colors",
                      activePreset === preset.key
                        ? "border-[#0c9de8] bg-blue-50 text-[#0c9de8]"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-4">
                {pickerView === "days" ? (
                  <>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => changeMonth(-1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                        aria-label="Previous month"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickerView("months")}
                        className="rounded-lg px-2 py-1 text-sm font-black text-slate-900 transition-colors hover:bg-slate-100"
                      >
                        {monthLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => changeMonth(1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                        aria-label="Next month"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wide text-slate-400">
                      {WEEKDAY_LABELS.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                    </div>

                    <div className="mt-1 grid grid-cols-7 gap-1">
                      {cells.map((cell, index) => {
                        if (!cell) return <span key={`blank-${index}`} />;
                        const isFuture = cell.dateKey > maxKey;
                        const isStart = cell.dateKey === start;
                        const isEnd = cell.dateKey === end;
                        const isInRange = Boolean(start && end && cell.dateKey > start && cell.dateKey < end);
                        const isToday = cell.dateKey === maxKey;
                        return (
                          <button
                            key={cell.dateKey}
                            type="button"
                            disabled={isFuture}
                            onClick={() => handleDayClick(cell.dateKey)}
                            className={cn(
                              "flex h-8 w-full items-center justify-center rounded-lg text-xs font-bold transition-colors",
                              isFuture && "cursor-not-allowed text-slate-200",
                              !isFuture && !isStart && !isEnd && !isInRange && "text-slate-700 hover:bg-slate-100",
                              isInRange && "rounded-none bg-blue-50 text-[#0c9de8]",
                              (isStart || isEnd) && "bg-[#0c9de8] text-white",
                              isStart && end && "rounded-r-none",
                              isEnd && start !== end && "rounded-l-none",
                              !isFuture && isToday && !isStart && !isEnd && "ring-1 ring-inset ring-[#0c9de8]/40",
                            )}
                          >
                            {cell.day}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setViewYear((year) => year - 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                        aria-label="Previous year"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <p className="text-sm font-black text-slate-900">{viewYear}</p>
                      <button
                        type="button"
                        onClick={() => setViewYear((year) => year + 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                        aria-label="Next year"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {MONTH_LABELS.map((label, index) => {
                        const isFutureMonth = viewYear > Number(maxKey.slice(0, 4))
                          || (viewYear === Number(maxKey.slice(0, 4)) && index > Number(maxKey.slice(5, 7)) - 1);
                        return (
                          <button
                            key={label}
                            type="button"
                            disabled={isFutureMonth}
                            onClick={() => { setViewMonth(index); setPickerView("days"); }}
                            className={cn(
                              "rounded-xl py-2.5 text-xs font-black transition-colors",
                              isFutureMonth && "cursor-not-allowed text-slate-200",
                              !isFutureMonth && index === viewMonth
                                ? "bg-[#0c9de8] text-white"
                                : !isFutureMonth && "bg-slate-50 text-slate-700 hover:bg-slate-100",
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
                <p className="text-[11px] font-black text-slate-600">
                  {start
                    ? `${formatDisplayDate(start)} – ${formatDisplayDate(end ?? start)} · ${dayCount(start, end ?? start)} day${dayCount(start, end ?? start) === 1 ? "" : "s"}`
                    : "No dates selected yet"}
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-600 transition-colors hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!start}
                  onClick={handleApply}
                  className="flex-1 rounded-2xl bg-[#0c9de8] py-3.5 text-sm font-black text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
