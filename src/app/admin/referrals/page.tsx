"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Gift, Loader2, PlayCircle, RefreshCw, ShieldAlert, Trophy, Users } from "lucide-react";

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

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />;
}

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">{children}</select>;
}

function Table({ title, rows, columns }: { title: string; rows: Array<any>; columns: Array<[string, (row: any, index: number) => string]> }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-black text-slate-900">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-slate-400">
            <tr>{columns.map(([label]) => <th key={label} className="border-b border-slate-100 px-2 py-2">{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-2 py-6 text-center font-semibold text-slate-400">No data yet.</td></tr>
            ) : rows.slice(0, 12).map((row, index) => (
              <tr key={`${title}-${row.id || row.user_id || index}`} className="border-b border-slate-50">
                {columns.map(([label, render]) => <td key={label} className="px-2 py-2 font-semibold text-slate-600">{render(row, index)}</td>)}
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
  const [milestone, setMilestone] = useState({ scope: "user", threshold_count: "10", reward_type: "withdrawable_balance", reward_amount: "0.25", reward_label: "10 verified referrals", status: "active" });
  const [teamName, setTeamName] = useState("");
  const [event, setEvent] = useState({ name: "Double Referral Week", team_id: "", multiplier: "2", starts_at: "", ends_at: "", status: "active" });

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/referrals");
    const json = await res.json();
    if (res.ok) setData(json);
    else setMessage(json.error || "Failed to load referral growth.");
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
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

  const exportRankings = () => {
    window.location.href = "/api/admin/referrals?export=rankings";
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><Trophy size={24} /> Referral Growth</h1>
            <p className="text-sm font-semibold text-slate-500">Referral rewards, sprint competitions, leaderboards, winner history, and anti-abuse review.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => submit({ action: "toggle_sprint", enabled: !data.sprint_enabled }, data.sprint_enabled ? "Referral Sprint disabled." : "Referral Sprint enabled.")} className={`rounded-lg px-4 py-2 text-xs font-black uppercase tracking-widest text-white ${data.sprint_enabled ? "bg-amber-600" : "bg-emerald-600"}`}>
              {data.sprint_enabled ? "Disable Sprint" : "Enable Sprint"}
            </button>
            <button onClick={() => submit({ action: "reset_sprint" }, "Referral Sprint reset.")} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
              Reset Sprint
            </button>
            <button onClick={exportRankings} className="rounded-lg bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 ring-1 ring-slate-200">
              Export Rankings
            </button>
            <button onClick={() => submit({ action: "finalize_sprints" }, "Expired sprints processed.")} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
              <RefreshCw className="mr-1 inline" size={14} /> Process Sprints
            </button>
          </div>
        </div>

        {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              {[
                ["Total Referrals", data.totals?.total_referrals || 0, Users],
                ["Verified", data.totals?.verified_referrals || 0, Gift],
                ["Rewards Paid", money(data.totals?.referral_rewards_paid || 0), Trophy],
                [data.sprint_enabled ? "Sprint Enabled" : "Classic Mode", data.sprint_enabled ? "On" : "Off", ShieldAlert],
              ].map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</p>
                      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3 text-blue-600"><Icon size={22} /></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Referral Settings</h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={setting.key} onChange={(value) => {
                    const found = data.settings.find((item) => item.key === value);
                    setSetting({ key: value, value: found?.value || "", description: found?.description || "" });
                  }}>
                    {data.settings.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}
                  </Select>
                  <Input value={setting.value} onChange={(value) => setSetting((prev) => ({ ...prev, value }))} />
                  <button onClick={() => submit({ action: "update_setting", ...setting })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save</button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {data.settings.slice(0, 10).map((item) => <div key={item.key} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.key}</b><br />{item.value}</div>)}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Active Sprint</h2>
                <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600">
                  <b>{data.active_sprint?.name || "Referral Sprint"}</b><br />
                  Ends {data.active_sprint?.ends_at ? new Date(data.active_sprint.ends_at).toLocaleString() : "not scheduled"} /
                  rewards {money(data.active_sprint?.first_place_reward)} / {money(data.active_sprint?.second_place_reward)} / {money(data.active_sprint?.third_place_reward)}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input value={sprint.duration_days} onChange={(value) => setSprint((prev) => ({ ...prev, duration_days: value }))} placeholder="Days" />
                  <Input value={sprint.first_place_reward} onChange={(value) => setSprint((prev) => ({ ...prev, first_place_reward: value }))} placeholder="1st" />
                  <Input value={sprint.second_place_reward} onChange={(value) => setSprint((prev) => ({ ...prev, second_place_reward: value }))} placeholder="2nd" />
                  <Input value={sprint.third_place_reward} onChange={(value) => setSprint((prev) => ({ ...prev, third_place_reward: value }))} placeholder="3rd" />
                  <Input value={sprint.best_team_reward} onChange={(value) => setSprint((prev) => ({ ...prev, best_team_reward: value }))} placeholder="Best team" />
                  <Input value={sprint.second_team_reward} onChange={(value) => setSprint((prev) => ({ ...prev, second_team_reward: value }))} placeholder="2nd team" />
                  <Input value={sprint.third_team_reward} onChange={(value) => setSprint((prev) => ({ ...prev, third_team_reward: value }))} placeholder="3rd team" />
                  <button onClick={() => setSprint((prev) => ({ ...prev, auto_restart: !prev.auto_restart }))} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600">
                    Auto Restart: {sprint.auto_restart ? "On" : "Off"}
                  </button>
                  <button onClick={() => submit({ action: "start_sprint", ...sprint }, "New sprint started.")} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
                    <PlayCircle className="mr-1 inline" size={14} /> Start
                  </button>
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Milestone Rewards</h2>
                <div className="grid gap-2">
                  <Select value={milestone.scope} onChange={(value) => setMilestone((prev) => ({ ...prev, scope: value }))}>
                    <option value="user">User</option>
                    <option value="team">Team</option>
                  </Select>
                  <Input value={milestone.threshold_count} onChange={(value) => setMilestone((prev) => ({ ...prev, threshold_count: value }))} placeholder="Referral count" />
                  <Select value={milestone.reward_type} onChange={(value) => setMilestone((prev) => ({ ...prev, reward_type: value }))}>
                    <option value="withdrawable_balance">Withdrawable Balance</option>
                    <option value="bonus_reward">Bonus Reward</option>
                    <option value="mystery_reward">Mystery Reward</option>
                  </Select>
                  <Input value={milestone.reward_amount} onChange={(value) => setMilestone((prev) => ({ ...prev, reward_amount: value }))} placeholder="Reward amount" />
                  <Input value={milestone.reward_label} onChange={(value) => setMilestone((prev) => ({ ...prev, reward_label: value }))} placeholder="Label" />
                  <button onClick={() => submit({ action: "save_milestone", ...milestone }, "Milestone saved.")} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Save Milestone</button>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Team Names</h2>
                <div className="flex gap-2">
                  <Input value={teamName} onChange={setTeamName} placeholder="New team name" />
                  <button onClick={() => submit({ action: "add_team_name", name: teamName }, "Team name added.")} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Add</button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.team_names.slice(0, 20).map((name) => <span key={name.name} className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-500">{name.name} / {name.status}</span>)}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black text-slate-900">Growth Events & Boosts</h2>
                <div className="grid gap-2">
                  <Input value={event.name} onChange={(value) => setEvent((prev) => ({ ...prev, name: value }))} placeholder="Event name" />
                  <Select value={event.team_id} onChange={(value) => setEvent((prev) => ({ ...prev, team_id: value }))}>
                    <option value="">All teams</option>
                    {data.teams.map((team) => <option key={team.id} value={team.id}>Team {team.name}</option>)}
                  </Select>
                  <Input value={event.multiplier} onChange={(value) => setEvent((prev) => ({ ...prev, multiplier: value }))} placeholder="Multiplier e.g. 1.2" />
                  <Input value={event.starts_at} onChange={(value) => setEvent((prev) => ({ ...prev, starts_at: value }))} placeholder="Starts YYYY-MM-DD HH:MM:SS" />
                  <Input value={event.ends_at} onChange={(value) => setEvent((prev) => ({ ...prev, ends_at: value }))} placeholder="Ends YYYY-MM-DD HH:MM:SS" />
                  <button onClick={() => submit({ action: "create_event", ...event }, "Growth event created.")} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Activate Event</button>
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Table title="Leaderboard" rows={data.leaderboard} columns={[
                ["Rank", (row) => `#${row.rank}`],
                ["User", (row) => row.display_name || `User #${row.user_id}`],
                ["Referrals", (row) => String(row.referral_count || 0)],
                ["Rewards", (row) => money(row.referral_rewards)],
              ]} />
              <Table title="Sprint Winners History" rows={data.history} columns={[
                ["Sprint", (row) => `#${row.sprint_id}`],
                ["Rank", (row) => `#${row.rank_position}`],
                ["User", (row) => row.display_name || `User #${row.user_id}`],
                ["Reward", (row) => money(row.reward_amount)],
              ]} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Table title="Team League" rows={data.teams} columns={[
                ["Team", (row) => row.name],
                ["Members", (row) => String(row.members || 0)],
                ["Capacity", (row) => String(row.capacity || 0)],
                ["Status", (row) => row.status],
              ]} />
              <Table title="Team Rewards History" rows={data.team_rewards} columns={[
                ["Sprint", (row) => `#${row.sprint_id}`],
                ["Team", (row) => row.name],
                ["Rank", (row) => `#${row.rank_position}`],
                ["Reward", (row) => money(row.reward_amount)],
              ]} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Table title="Configured Milestones" rows={data.milestones} columns={[
                ["Scope", (row) => row.scope],
                ["Count", (row) => String(row.threshold_count)],
                ["Type", (row) => row.reward_type],
                ["Reward", (row) => money(row.reward_amount)],
              ]} />
              <Table title="Active & Scheduled Events" rows={data.events} columns={[
                ["Name", (row) => row.name],
                ["Team", (row) => row.team_name || "All"],
                ["Boost", (row) => `${Number(row.multiplier || 1)}x`],
                ["Ends", (row) => new Date(row.ends_at).toLocaleString()],
              ]} />
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-black text-slate-900">Anti-Abuse Review</h2>
              <div className="space-y-2">
                {data.abuse.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400">No open referral abuse flags.</p> : data.abuse.map((flag) => (
                  <div key={flag.id} className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black text-slate-900">{flag.signal_key} / {flag.risk_level}</p>
                      <p className="text-xs font-semibold text-slate-500">{flag.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => submit({ action: "review_abuse", id: flag.id, status: "dismissed" })} className="rounded-md border border-slate-200 px-3 py-1 text-[10px] font-black uppercase text-slate-600">Dismiss</button>
                      <button onClick={() => submit({ action: "review_abuse", id: flag.id, status: "confirmed" })} className="rounded-md bg-red-600 px-3 py-1 text-[10px] font-black uppercase text-white">Confirm</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Table title="Recent Audit Logs" rows={data.audits} columns={[
              ["Action", (row) => row.action],
              ["Entity", (row) => `${row.entity_type} #${row.entity_id || "-"}`],
              ["Reason", (row) => row.reason || "-"],
              ["Time", (row) => new Date(row.created_at).toLocaleString()],
            ]} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
