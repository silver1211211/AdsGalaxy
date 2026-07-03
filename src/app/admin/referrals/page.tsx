"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy admin referral payload is dynamically shaped */

import React, { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Activity,
  AlertTriangle,
  Clock,
  Gift,
  Loader2,
  Medal,
  PlayCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";

type AdminReferralData = {
  sprint_enabled: boolean;
  settings: Array<any>;
  sprints: Array<any>;
  active_sprint: any;
  leaderboard: Array<any>;
  history: Array<any>;
  team_rewards: Array<any>;
  teams: Array<any>;
  team_names: Array<any>;
  milestones: Array<any>;
  events: Array<any>;
  abuse: Array<any>;
  audits: Array<any>;
  totals: any;
};

const emptyData: AdminReferralData = {
  sprint_enabled: true,
  settings: [],
  sprints: [],
  active_sprint: null,
  leaderboard: [],
  history: [],
  team_rewards: [],
  teams: [],
  team_names: [],
  milestones: [],
  events: [],
  abuse: [],
  audits: [],
  totals: {},
};

const SETTING_LABELS: Record<string, string> = {
  referral_sprint_enabled: "Referral Sprint",
  referral_join_reward_amount: "Join Reward",
  referral_verification_reward_amount: "Channel Verification Bonus",
  referral_reward_amount: "Total Referral Reward",
  referral_sprint_popup_interval_seconds: "Popup Interval Seconds",
  referral_sprint_popup_interval_hours: "Popup Interval Hours",
  required_channel_url: "Required Channel URL",
  required_channel_username: "Required Channel Username",
  sprint_duration_days: "Sprint Duration Days",
  sprint_first_place_reward: "Sprint 1st Place Reward",
  sprint_second_place_reward: "Sprint 2nd Place Reward",
  sprint_third_place_reward: "Sprint 3rd Place Reward",
  sprint_auto_restart: "Sprint Auto Restart",
  team_best_reward: "Team 1st Place Reward",
  team_second_reward: "Team 2nd Place Reward",
  team_third_reward: "Team 3rd Place Reward",
  team_league_unlock_referrals: "Team League Unlock Referrals",
  referral_settlement_time: "Daily Settlement Time",
  referral_fraud_min_channel_conversion_percent: "Minimum Quality Conversion %",
  team_sprint_referral_target: "Daily Team Referral Target",
  team_sprint_reward_pool: "Daily Team Reward Pool",
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  referral_sprint_enabled: "Controls Referral Sprint, sprint popup, leaderboard, teams, and growth UI.",
  referral_join_reward_amount: "Paid when a referred user first joins AdsGalaxy.",
  referral_verification_reward_amount: "Paid after the referred user joins and verifies the required Telegram channel.",
  referral_reward_amount: "Displayed total reward amount. It should equal join reward plus verification bonus.",
  referral_sprint_popup_interval_seconds: "Seconds to wait before the Referral Sprint popup can appear again.",
  referral_sprint_popup_interval_hours: "Legacy fallback interval in hours.",
  required_channel_url: "Telegram channel users must join before the verification bonus is paid.",
  required_channel_username: "Telegram username used by the membership check.",
};

function money(value: unknown, digits = 2) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 3 })}`;
}

function settingLabel(key: string) {
  return SETTING_LABELS[key] || key.replace(/_/g, " ");
}

function formatDate(value?: string | null) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString();
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[10px] font-semibold leading-4 text-slate-400">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange, label, placeholder, hint }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-[#0c9de8] focus:ring-4 focus:ring-[#0c9de8]/10"
      />
    </Field>
  );
}

function Select({ value, onChange, label, hint, children }: { value: string; onChange: (value: string) => void; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition-colors focus:border-[#0c9de8] focus:ring-4 focus:ring-[#0c9de8]/10"
      >
        {children}
      </select>
    </Field>
  );
}

function Section({ title, subtitle, icon: Icon, children }: { title: string; subtitle?: string; icon?: any; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
      <div className="mb-4 flex items-start gap-3">
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0c9de8]">
            <Icon size={18} />
          </div>
        )}
        <div>
          <h2 className="text-sm font-black text-slate-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function StatCard({ label, value, icon: Icon, tone = "blue" }: { label: string; value: React.ReactNode; icon: any; tone?: "blue" | "green" | "amber" | "slate" }) {
  const toneClass = {
    blue: "bg-blue-50 text-[#0c9de8]",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-700",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${toneClass}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function Table({ title, rows, columns }: { title: string; rows: Array<any>; columns: Array<[string, (row: any, index: number) => React.ReactNode]> }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
      <h2 className="mb-3 text-sm font-black text-slate-950">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-slate-400">
            <tr>{columns.map(([label]) => <th key={label} className="border-b border-slate-100 px-2 py-2">{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-2 py-8 text-center font-semibold text-slate-400">No data yet.</td></tr>
            ) : rows.slice(0, 12).map((row, index) => (
              <tr key={`${title}-${row.id || row.user_id || row.team_id || index}`} className="border-b border-slate-50 last:border-0">
                {columns.map(([label, render]) => <td key={label} className="px-2 py-3 font-semibold text-slate-600">{render(row, index)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AdminReferralsPage() {
  const [data, setData] = useState<AdminReferralData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [setting, setSetting] = useState({ key: "referral_reward_amount", value: "0.015", description: "" });
  const [sprint, setSprint] = useState({ name: "Referral Sprint", duration_days: "14", first_place_reward: "10", second_place_reward: "5", third_place_reward: "2", best_team_reward: "15", second_team_reward: "8", third_team_reward: "4", auto_restart: true });
  const [milestone, setMilestone] = useState({ id: "", scope: "user", threshold_count: "10", reward_type: "withdrawable_balance", reward_amount: "0.25", reward_label: "10 verified referrals", status: "active" });
  const [teamName, setTeamName] = useState("");
  const [event, setEvent] = useState({ name: "Double Referral Week", team_id: "", multiplier: "2", starts_at: "", ends_at: "", status: "active" });

  const getSettingItem = (key: string) => data.settings.find((item) => item.key === key);
  const getSettingValue = (key: string, fallback = "") => String(getSettingItem(key)?.value ?? fallback);
  const setSettingValue = (key: string, value: string) => {
    setData((prev) => {
      const exists = prev.settings.some((item) => item.key === key);
      return {
        ...prev,
        settings: exists
          ? prev.settings.map((item) => item.key === key ? { ...item, value } : item)
          : [...prev.settings, { key, value, description: SETTING_DESCRIPTIONS[key] || "" }],
      };
    });
  };

  const popupIntervalSeconds = Math.max(
    0,
    Number.parseInt(getSettingValue("referral_sprint_popup_interval_seconds", String(Number(getSettingValue("referral_sprint_popup_interval_hours", "24")) * 3600)), 10) || 0
  );
  const popupInterval = {
    hours: String(Math.floor(popupIntervalSeconds / 3600)),
    minutes: String(Math.floor((popupIntervalSeconds % 3600) / 60)),
    seconds: String(popupIntervalSeconds % 60),
  };
  const activeSprintName = data.active_sprint?.name || (data.sprint_enabled ? "Referral Sprint" : "Sprint disabled");
  const sprintEndsAt = data.active_sprint?.ends_at ? formatDate(data.active_sprint.ends_at) : "Not scheduled";

  const allSettings = useMemo(() => data.settings.slice().sort((a, b) => String(a.key).localeCompare(String(b.key))), [data.settings]);

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/referrals");
    const json = await res.json().catch(() => ({}));
    if (res.ok) setData(json);
    else setMessage(json.error || "Failed to load referral growth.");
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/referrals")
      .then(async (response) => ({ response, json: await response.json().catch(() => ({})) }))
      .then(({ response, json }) => {
        if (!active) return;
        if (response.ok) setData(json);
        else setMessage(json.error || "Failed to load referral growth.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const submit = async (payload: Record<string, unknown>, success = "Saved.") => {
    setMessage("");
    const res = await fetch("/api/admin/referrals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok ? success : json.error || "Action failed.");
    if (res.ok) await fetchData();
  };

  const saveSetting = (key: string, success = "Setting saved.") => {
    const item = getSettingItem(key);
    return submit({
      action: "update_setting",
      key,
      value: getSettingValue(key),
      description: item?.description || SETTING_DESCRIPTIONS[key] || settingLabel(key),
    }, success);
  };

  const setPopupIntervalPart = (part: "hours" | "minutes" | "seconds", value: string) => {
    const cleanValue = Math.max(0, Number.parseInt(value || "0", 10) || 0);
    const next = {
      hours: Number(popupInterval.hours),
      minutes: Number(popupInterval.minutes),
      seconds: Number(popupInterval.seconds),
      [part]: cleanValue,
    };
    setSettingValue("referral_sprint_popup_interval_seconds", String(Math.max(0, (next.hours * 3600) + (next.minutes * 60) + next.seconds)));
  };

  const savePopupInterval = () => submit({
    action: "update_setting",
    key: "referral_sprint_popup_interval_seconds",
    value: getSettingValue("referral_sprint_popup_interval_seconds", String(popupIntervalSeconds)),
    description: SETTING_DESCRIPTIONS.referral_sprint_popup_interval_seconds,
  }, "Popup interval saved.");

  return (
    <AdminLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-r from-[#13aef5] to-[#0b86d6] text-white shadow-xl shadow-[#0c9de8]/20">
          <div className="p-6 sm:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                  <Trophy size={13} />
                  Referral Growth System
                </div>
                <h1 className="text-3xl font-black tracking-tight">Referral Sprint Control Center</h1>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-blue-50">
                  Manage rewards, popup interval, sprint competition, teams, milestones, abuse review, and payout history from one place.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => submit({ action: "toggle_sprint", enabled: !data.sprint_enabled }, data.sprint_enabled ? "Referral Sprint disabled. Popup is off." : "Referral Sprint enabled.")}
                  className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition-all active:scale-[0.98] ${data.sprint_enabled ? "bg-orange-500 shadow-orange-700/20" : "bg-emerald-500 shadow-emerald-700/20"}`}
                >
                  {data.sprint_enabled ? "Turn Sprint Off" : "Turn Sprint On"}
                </button>
                <button onClick={() => submit({ action: "reset_sprint" }, "Referral Sprint reset.")} className="rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-[#0c9de8] shadow-lg shadow-blue-950/10">
                  Reset Sprint
                </button>
                <button onClick={() => submit({ action: "finalize_sprints" }, "Expired sprints processed.")} className="rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-blue-950/20">
                  <RefreshCw className="mr-1 inline" size={14} /> Process Sprints
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-white/15 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Current Mode</p>
                <p className="mt-2 text-xl font-black">{data.sprint_enabled ? "Sprint On" : "Sprint Off"}</p>
              </div>
              <div className="rounded-2xl bg-white/15 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Active Sprint</p>
                <p className="mt-2 truncate text-xl font-black">{activeSprintName}</p>
              </div>
              <div className="rounded-2xl bg-white/15 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Ends At</p>
                <p className="mt-2 truncate text-sm font-black">{sprintEndsAt}</p>
              </div>
            </div>
          </div>
        </section>

        {message && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-black text-blue-700">{message}</div>}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white py-20 text-center shadow-sm">
            <Loader2 className="mx-auto animate-spin text-[#0c9de8]" size={30} />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard label="Total Referrals" value={data.totals?.total_referrals || 0} icon={Users} />
              <StatCard label="Verified" value={data.totals?.verified_referrals || 0} icon={ShieldCheck} tone="green" />
              <StatCard label="Rewards Paid" value={money(data.totals?.referral_rewards_paid || 0)} icon={Gift} tone="amber" />
              <StatCard label="Open Abuse Flags" value={data.abuse.length || 0} icon={AlertTriangle} tone={data.abuse.length ? "amber" : "slate"} />
            </div>

            <Section title="Core Referral Controls" subtitle="User-facing reward amounts, popup frequency, required channel, and sprint state." icon={Settings2}>
              <div className="grid gap-4 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <Input label="Join Reward" value={getSettingValue("referral_join_reward_amount", "0.005")} onChange={(value) => setSettingValue("referral_join_reward_amount", value)} hint="Paid when a referral first joins." />
                  <button onClick={() => saveSetting("referral_join_reward_amount", "Join reward saved.")} className="mt-3 h-11 w-full rounded-xl bg-[#0c9de8] text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <Input label="Verification Bonus" value={getSettingValue("referral_verification_reward_amount", "0.010")} onChange={(value) => setSettingValue("referral_verification_reward_amount", value)} hint="Paid after channel verification." />
                  <button onClick={() => saveSetting("referral_verification_reward_amount", "Verification bonus saved.")} className="mt-3 h-11 w-full rounded-xl bg-[#0c9de8] text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 xl:col-span-2">
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">Sprint Popup Interval</p>
                  <p className="mb-3 text-[10px] font-semibold text-slate-400">0 allows it again immediately in a new browser session. Turning sprint off disables the popup.</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Input label="Hours" value={popupInterval.hours} onChange={(value) => setPopupIntervalPart("hours", value)} />
                    <Input label="Minutes" value={popupInterval.minutes} onChange={(value) => setPopupIntervalPart("minutes", value)} />
                    <Input label="Seconds" value={popupInterval.seconds} onChange={(value) => setPopupIntervalPart("seconds", value)} />
                  </div>
                  <p className="mt-2 text-[10px] font-bold text-slate-500">Saved as {popupIntervalSeconds.toLocaleString()} seconds.</p>
                  <button onClick={savePopupInterval} className="mt-3 h-11 w-full rounded-xl bg-[#0c9de8] text-xs font-black uppercase tracking-widest text-white">Save Popup Interval</button>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 xl:col-span-2">
                  <Input label="Required Channel URL" value={getSettingValue("required_channel_url", "https://t.me/AdsGalaxy_News")} onChange={(value) => setSettingValue("required_channel_url", value)} hint="Used for the verification bonus." />
                  <button onClick={() => saveSetting("required_channel_url", "Required channel saved.")} className="mt-3 h-11 w-full rounded-xl bg-[#0c9de8] text-xs font-black uppercase tracking-widest text-white">Save Required Channel</button>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 xl:col-span-2">
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">Sprint Availability</p>
                  <p className="mb-3 text-xs font-semibold text-slate-500">
                    {data.sprint_enabled ? "Sprint features and popup are active." : "Sprint features and popup are disabled."}
                  </p>
                  <button
                    onClick={() => submit({ action: "toggle_sprint", enabled: !data.sprint_enabled }, data.sprint_enabled ? "Referral Sprint disabled. Popup is off." : "Referral Sprint enabled.")}
                    className={`h-11 w-full rounded-xl text-xs font-black uppercase tracking-widest text-white ${data.sprint_enabled ? "bg-orange-500" : "bg-emerald-500"}`}
                  >
                    {data.sprint_enabled ? "Turn Sprint Off" : "Turn Sprint On"}
                  </button>
                </div>
              </div>
            </Section>

            <div className="grid gap-5 xl:grid-cols-2">
              <Section title="Sprint Setup" subtitle="Start a fresh sprint or adjust prize values before launch." icon={Trophy}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input label="Duration Days" value={sprint.duration_days} onChange={(value) => setSprint((prev) => ({ ...prev, duration_days: value }))} />
                  <Input label="1st Place Reward" value={sprint.first_place_reward} onChange={(value) => setSprint((prev) => ({ ...prev, first_place_reward: value }))} />
                  <Input label="2nd Place Reward" value={sprint.second_place_reward} onChange={(value) => setSprint((prev) => ({ ...prev, second_place_reward: value }))} />
                  <Input label="3rd Place Reward" value={sprint.third_place_reward} onChange={(value) => setSprint((prev) => ({ ...prev, third_place_reward: value }))} />
                  <Input label="1st Team Reward" value={sprint.best_team_reward} onChange={(value) => setSprint((prev) => ({ ...prev, best_team_reward: value }))} />
                  <Input label="2nd Team Reward" value={sprint.second_team_reward} onChange={(value) => setSprint((prev) => ({ ...prev, second_team_reward: value }))} />
                  <Input label="3rd Team Reward" value={sprint.third_team_reward} onChange={(value) => setSprint((prev) => ({ ...prev, third_team_reward: value }))} />
                  <button onClick={() => setSprint((prev) => ({ ...prev, auto_restart: !prev.auto_restart }))} className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-600">
                    Auto Restart: {sprint.auto_restart ? "On" : "Off"}
                  </button>
                  <button onClick={() => submit({ action: "start_sprint", ...sprint }, "New sprint started.")} className="h-11 rounded-xl bg-emerald-600 px-4 text-xs font-black uppercase tracking-widest text-white">
                    <PlayCircle className="mr-1 inline" size={14} /> Start
                  </button>
                </div>
              </Section>

              <Section title="All Referral Settings" subtitle="Every saved key is visible here. Click one to edit it." icon={Activity}>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Select label="Setting Key" value={setting.key} onChange={(value) => {
                    const found = data.settings.find((item) => item.key === value);
                    setSetting({ key: value, value: found?.value || "", description: found?.description || "" });
                  }}>
                    {allSettings.map((item) => <option key={item.key} value={item.key}>{settingLabel(item.key)}</option>)}
                  </Select>
                  <Input label="Setting Value" value={setting.value} onChange={(value) => setSetting((prev) => ({ ...prev, value }))} />
                  <button onClick={() => submit({ action: "update_setting", ...setting })} className="mt-5 h-11 rounded-xl bg-[#0c9de8] px-5 text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {allSettings.map((item) => (
                    <button key={item.key} onClick={() => setSetting({ key: item.key, value: item.value || "", description: item.description || "" })} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-left text-xs transition-colors hover:border-blue-100 hover:bg-blue-50">
                      <b className="block text-slate-900">{settingLabel(item.key)}</b>
                      <span className="font-mono text-[#0c9de8]">{item.value}</span>
                      {item.description && <span className="mt-1 block text-[10px] font-semibold leading-4 text-slate-500">{item.description}</span>}
                    </button>
                  ))}
                </div>
              </Section>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <Section title="Milestone Rewards" subtitle="Extra rewards for user or team referral targets." icon={Medal}>
                <div className="grid gap-3">
                  <Select label="Milestone Scope" value={milestone.scope} onChange={(value) => setMilestone((prev) => ({ ...prev, scope: value }))}>
                    <option value="user">User</option>
                    <option value="team">Team</option>
                  </Select>
                  <Input label="Referral Count Required" value={milestone.threshold_count} onChange={(value) => setMilestone((prev) => ({ ...prev, threshold_count: value }))} />
                  <Input label="Reward Amount" value={milestone.reward_amount} onChange={(value) => setMilestone((prev) => ({ ...prev, reward_amount: value }))} />
                  <Input label="Display Label" value={milestone.reward_label} onChange={(value) => setMilestone((prev) => ({ ...prev, reward_label: value }))} />
                  <button onClick={() => submit({ action: "save_milestone", ...milestone }, "Milestone saved.")} className="h-11 rounded-xl bg-[#0c9de8] text-xs font-black uppercase tracking-widest text-white">Save Milestone</button>
                </div>
              </Section>

              <Section title="Team Names" subtitle="Seed or extend team league names." icon={Users}>
                <div className="flex gap-2">
                  <div className="flex-1"><Input label="New Team Name" value={teamName} onChange={setTeamName} /></div>
                  <button onClick={() => submit({ action: "add_team_name", name: teamName }, "Team name added.")} className="mt-5 h-11 rounded-xl bg-slate-950 px-4 text-xs font-black uppercase tracking-widest text-white">Add</button>
                </div>
                <div className="mt-4 flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                  {data.team_names.slice(0, 40).map((name) => <span key={name.name} className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase text-[#0c9de8]">{name.name} / {name.status}</span>)}
                </div>
              </Section>

              <Section title="Growth Events" subtitle="Temporary reward boosts for everyone or selected teams." icon={Clock}>
                <div className="grid gap-3">
                  <Input label="Event Name" value={event.name} onChange={(value) => setEvent((prev) => ({ ...prev, name: value }))} />
                  <Select label="Boost Applies To" value={event.team_id} onChange={(value) => setEvent((prev) => ({ ...prev, team_id: value }))}>
                    <option value="">All teams</option>
                    {data.teams.map((team) => <option key={team.id} value={team.id}>Team {team.name}</option>)}
                  </Select>
                  <Input label="Reward Multiplier" value={event.multiplier} onChange={(value) => setEvent((prev) => ({ ...prev, multiplier: value }))} />
                  <Input label="Starts At" value={event.starts_at} onChange={(value) => setEvent((prev) => ({ ...prev, starts_at: value }))} placeholder="YYYY-MM-DD HH:MM:SS" />
                  <Input label="Ends At" value={event.ends_at} onChange={(value) => setEvent((prev) => ({ ...prev, ends_at: value }))} placeholder="YYYY-MM-DD HH:MM:SS" />
                  <button onClick={() => submit({ action: "create_event", ...event }, "Growth event created.")} className="h-11 rounded-xl bg-emerald-600 text-xs font-black uppercase tracking-widest text-white">Activate Event</button>
                </div>
              </Section>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Table title="Sprint Leaderboard" rows={data.leaderboard} columns={[
                ["Rank", (row) => `#${row.rank}`],
                ["User", (row) => row.display_name || `User #${row.user_id}`],
                ["Verified", (row) => String(row.referral_count || 0)],
                ["Rewards", (row) => money(row.referral_rewards || 0)],
              ]} />
              <Table title="Team League" rows={data.teams} columns={[
                ["Team", (row) => row.name],
                ["Members", (row) => String(row.members || 0)],
                ["Capacity", (row) => String(row.capacity || 0)],
                ["Status", (row) => row.status],
              ]} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Table title="Configured Milestones" rows={data.milestones} columns={[
                ["Scope", (row) => row.scope],
                ["Count", (row) => String(row.threshold_count)],
                ["Reward", (row) => money(row.reward_amount)],
                ["Status", (row) => row.status],
                ["Action", (row) => (
                  <button
                    onClick={() => setMilestone({
                      id: String(row.id),
                      scope: String(row.scope || "user"),
                      threshold_count: String(row.threshold_count || "1"),
                      reward_type: String(row.reward_type || "withdrawable_balance"),
                      reward_amount: String(row.reward_amount || "0"),
                      reward_label: String(row.reward_label || ""),
                      status: String(row.status || "active"),
                    })}
                    className="rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-black uppercase text-[#0c9de8]"
                  >Edit</button>
                )],
              ]} />
              <Table title="Active & Scheduled Events" rows={data.events} columns={[
                ["Name", (row) => row.name],
                ["Team", (row) => row.team_name || "All"],
                ["Boost", (row) => `${Number(row.multiplier || 1)}x`],
                ["Ends", (row) => formatDate(row.ends_at)],
              ]} />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Table title="Sprint Winners History" rows={data.history} columns={[
                ["Sprint", (row) => `#${row.sprint_id}`],
                ["Rank", (row) => `#${row.rank_position}`],
                ["User", (row) => row.display_name || `User #${row.user_id}`],
                ["Reward", (row) => money(row.reward_amount)],
              ]} />
              <Table title="Team Rewards History" rows={data.team_rewards} columns={[
                ["Sprint", (row) => `#${row.sprint_id}`],
                ["Team", (row) => row.name],
                ["Rank", (row) => `#${row.rank_position}`],
                ["Reward", (row) => money(row.reward_amount)],
              ]} />
            </div>

            <Section title="Anti-Abuse Review" subtitle="Review suspicious referral activity before it damages reward accuracy." icon={AlertTriangle}>
              <div className="space-y-2">
                {data.abuse.length === 0 ? <p className="py-8 text-center text-xs font-semibold text-slate-400">No open referral abuse flags.</p> : data.abuse.map((flag) => (
                  <div key={flag.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black text-slate-900">{flag.signal_key} / {flag.risk_level}</p>
                      <p className="text-xs font-semibold text-slate-500">{flag.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => submit({ action: "review_abuse", id: flag.id, status: "dismissed" })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600">Dismiss</button>
                      <button onClick={() => submit({ action: "review_abuse", id: flag.id, status: "confirmed" })} className="rounded-lg bg-red-600 px-3 py-2 text-[10px] font-black uppercase text-white">Confirm</button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Table title="Recent Audit Logs" rows={data.audits} columns={[
              ["Action", (row) => row.action],
              ["Entity", (row) => `${row.entity_type} #${row.entity_id || "-"}`],
              ["Reason", (row) => row.reason || "-"],
              ["Time", (row) => formatDate(row.created_at)],
            ]} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
