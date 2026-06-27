"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Lightbulb, Loader2, MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Recommendation = {
  id: number;
  recommendation_type: string;
  severity: string;
  status: string;
  feedback?: string | null;
  title: string;
  summary: string;
  action_label?: string | null;
  masked_subject?: string | null;
  score_explanation?: string | null;
  suggestions?: Record<string, any> | null;
  metrics?: Record<string, any> | null;
  automation_eligible?: number | boolean;
  updated_at?: string;
};

type Props = {
  endpoint: string;
  title: string;
  intro: string;
  showAutomationMode?: boolean;
};

const statuses = ["open", "applied", "ignored", "resolved"];
const modes = [
  ["manual", "Manual"],
  ["recommend_only", "Recommend Only"],
  ["semi_automatic", "Semi-Automatic"],
  ["automatic", "Automatic"],
];

function tone(severity: string) {
  if (severity === "critical" || severity === "high") return "border-red-100 bg-red-50/60 text-red-700";
  if (severity === "medium") return "border-amber-100 bg-amber-50/60 text-amber-700";
  return "border-blue-100 bg-blue-50/60 text-blue-700";
}

function label(value: string) {
  return value.replace(/_/g, " ");
}

function suggestionLines(value: Record<string, any> | null | undefined) {
  if (!value) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.entries(item).map(([innerKey, innerValue]) => `${label(innerKey)}: ${Array.isArray(innerValue) ? innerValue.join(", ") : String(innerValue)}`);
    }
    if (Array.isArray(item)) return [`${label(key)}: ${item.join(", ")}`];
    return [`${label(key)}: ${String(item)}`];
  }).slice(0, 8);
}

export default function SmartRecommendationsPanel({ endpoint, title, intro, showAutomationMode = false }: Props) {
  const [items, setItems] = React.useState<Recommendation[]>([]);
  const [settings, setSettings] = React.useState<Record<string, string>>({});
  const [status, setStatus] = React.useState("open");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<number | string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`${endpoint}?status=${status}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setItems(data.recommendations || []);
      setSettings(data.settings || {});
    }
    setLoading(false);
  }, [endpoint, status]);

  React.useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, key: number | string) => {
    setSaving(key);
    const res = await apiFetch(endpoint, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (data.settings) setSettings(data.settings);
      await load();
    }
    setSaving(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {statuses.map((item) => (
            <button
              key={item}
              onClick={() => setStatus(item)}
              className={`rounded-xl border px-3 py-2 text-xs font-black capitalize ${status === item ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}
            >
              {label(item)}
            </button>
          ))}
        </div>
      </div>

      {showAutomationMode && (
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900">Automation Mode</h2>
              <p className="text-xs font-semibold text-slate-500">Default is Recommend Only. Automatic mode is prepared for low-risk helpers only.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {modes.map(([value, text]) => (
                <button
                  key={value}
                  disabled={saving === "mode"}
                  onClick={() => patch({ automation_mode: value }, "mode")}
                  className={`rounded-xl border px-3 py-2 text-xs font-black ${settings.smart_automation_mode === value ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center shadow-sm">
          <CheckCircle2 className="mx-auto text-emerald-500" size={32} />
          <p className="mt-3 text-sm font-black text-slate-900">No recommendations in this status.</p>
          <p className="text-xs font-semibold text-slate-500">Rule-based checks will populate this area when there is something useful to review.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase ${tone(item.severity)}`}>
                      {item.severity === "high" || item.severity === "critical" ? <AlertTriangle size={12} /> : <Lightbulb size={12} />}
                      {label(item.severity)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-500">{label(item.recommendation_type)}</span>
                    {item.automation_eligible ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700">low-risk helper</span> : null}
                    {item.masked_subject ? <span className="text-[10px] font-bold uppercase text-slate-400">{item.masked_subject}</span> : null}
                  </div>
                  <h2 className="mt-3 text-lg font-black text-slate-900">{item.title}</h2>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{item.summary}</p>
                  {item.score_explanation && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">{item.score_explanation}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {["applied", "ignored", "resolved"].map((next) => (
                    <button
                      key={next}
                      disabled={saving === item.id}
                      onClick={() => patch({ id: item.id, status: next }, item.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black capitalize text-slate-600"
                    >
                      {label(next)}
                    </button>
                  ))}
                  <button disabled={saving === item.id} onClick={() => patch({ id: item.id, feedback: "helpful" }, item.id)} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-emerald-700"><ThumbsUp size={14} /></button>
                  <button disabled={saving === item.id} onClick={() => patch({ id: item.id, feedback: "not_helpful" }, item.id)} className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-red-700"><ThumbsDown size={14} /></button>
                </div>
              </div>
              {suggestionLines(item.suggestions).length > 0 && (
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {suggestionLines(item.suggestions).map((line) => (
                    <div key={line} className="flex gap-2 rounded-xl bg-blue-50/60 p-3 text-xs font-semibold leading-5 text-blue-800">
                      <MessageSquare className="mt-0.5 shrink-0" size={14} />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
