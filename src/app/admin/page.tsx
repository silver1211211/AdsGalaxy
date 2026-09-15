"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/static-components -- legacy dashboard helpers are defined inline */

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Users, Megaphone, Tv, CreditCard, DollarSign, Activity, AlertCircle, CheckCircle, Clock, XCircle, TrendingUp, Bot, ShieldCheck, Smartphone, Eye, Wallet } from "lucide-react";
import Link from "next/link";

const DASHBOARD_CACHE_KEY = "ads-galaxy-admin-dashboard-v1";

function readCachedDashboard() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return cached && typeof cached === "object" ? cached : null;
  } catch {
    return null;
  }
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(() => readCachedDashboard());
  const [loading, setLoading] = useState(() => !readCachedDashboard());
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/dashboard/summary?fresh=1", { cache: "no-store", signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        setSummary(data);
        setStats((current: any) => current ? {
          ...current,
          users: { ...current.users, ...data.users },
        } : current);
      })
      .catch(() => { /* Full dashboard refresh remains independent. */ });
    fetch("/api/admin/dashboard?fresh=1", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Dashboard refresh failed");
        return data;
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStats(data);
        setError("");
        try {
          window.sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(data));
        } catch {
          // Storage is an optimization only.
        }
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  const viewStats = stats || {
    users: { total: summary?.users?.total || 0, today: summary?.users?.today || 0, week: 0, month: 0 },
    financials: { totalDeposits: "0", totalWithdrawals: "0" },
    channels: { totalSubscribers: 0, pending: 0, approved: 0, deliveryEligible: 0, rejected: 0, approvedSubscribers: 0 },
    bots: { total: 0, deliveryEligible: 0, activeUsers: 0, deliveryEligibleUsers: 0, totalUsers: 0 },
    miniapps: { active: 0, impressionsToday: 0, impressionsYesterday: 0 },
    conversions: { total: 0, value: 0, open_reviews: 0, attribution_window_days: 7, top_campaigns: [], top_categories: [], top_inventory: [] },
    trust_safety: {},
    campaigns: { total: 0, pending: summary?.campaigns?.pending || 0, active: summary?.campaigns?.active || 0, rejected: 0, pending_by_type: {} },
    withdrawals: { total: 0, pending: summary?.withdrawals?.pending || 0, success: 0, rejected: 0 },
  };

  const StatCard = ({ title, value, icon: Icon, bgClass, textClass, subtitle, secondaryLabel, secondaryValue }: any) => (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</p>
          <h3 className="text-2xl font-black text-slate-900">{value}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-1 font-medium">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-lg ${bgClass} flex-shrink-0`}>
          <Icon size={24} className={textClass} />
        </div>
      </div>
      {secondaryLabel && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{secondaryLabel}</span>
          <span className="text-sm font-black text-slate-700">{secondaryValue}</span>
        </div>
      )}
    </div>
  );

  const SectionHeader = ({ title, icon: Icon, href }: any) => (
    <div className="flex items-center justify-between mb-4 mt-8">
      <div className="flex items-center gap-2">
        <Icon className="text-slate-700" size={20} />
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors">
          View All &rarr;
        </Link>
      )}
    </div>
  );

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Platform Overview</h1>
        <p className="text-sm text-slate-500 font-medium">Real-time statistics and pending actions.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          Some dashboard metrics could not be refreshed. Showing the available summary or last cached snapshot. {error}
        </div>
      )}
      {loading && <p className="mb-2 text-xs font-semibold text-slate-500" role="status">Refreshing detailed metrics…</p>}

      <div className="space-y-8">
        
        {/* User Growth */}
        <div>
          <SectionHeader title="User Growth" icon={Users} href="/admin/users" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Users" value={viewStats.users.total} icon={Users} bgClass="bg-blue-100" textClass="text-blue-600" />
            <StatCard title="New Today" value={`+${viewStats.users.today}`} icon={TrendingUp} bgClass="bg-emerald-100" textClass="text-emerald-600" />
            <StatCard title="New This Week" value={`+${viewStats.users.week}`} icon={Activity} bgClass="bg-emerald-100" textClass="text-emerald-600" subtitle="Last 7 Days" />
            <StatCard title="New This Month" value={`+${viewStats.users.month}`} icon={Activity} bgClass="bg-indigo-100" textClass="text-indigo-600" subtitle="Last 30 Days" />
          </div>
        </div>

        {/* Financials Overview */}
        <div>
          <SectionHeader title="Financials Overview" icon={DollarSign} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm font-bold text-emerald-800 uppercase tracking-wide">Total Processed Deposits</p>
                <h3 className="text-3xl font-black text-emerald-900 mt-1">${parseFloat(viewStats.financials.totalDeposits).toLocaleString('en-US', {minimumFractionDigits: 2})}</h3>
              </div>
              <Wallet className="text-emerald-500 opacity-50" size={48} />
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm font-bold text-orange-800 uppercase tracking-wide">Total Paid Withdrawals</p>
                <h3 className="text-3xl font-black text-orange-900 mt-1">${parseFloat(viewStats.financials.totalWithdrawals).toLocaleString('en-US', {minimumFractionDigits: 2})}</h3>
              </div>
              <CreditCard className="text-orange-500 opacity-50" size={48} />
            </div>
          </div>
        </div>

        {/* Network Reach */}
        <div>
          <SectionHeader title="Network Reach" icon={Activity} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard title="Total Subscribers" value={viewStats.channels.totalSubscribers.toLocaleString()} icon={Users} bgClass="bg-blue-100" textClass="text-blue-600" subtitle="Across all non-deleted channels" />
            <StatCard title="Monetized Bots" value={viewStats.bots.total} icon={Bot} bgClass="bg-purple-100" textClass="text-purple-600" subtitle="Lifecycle active" secondaryLabel="Delivery Eligible" secondaryValue={(viewStats.bots.deliveryEligible || 0).toLocaleString()} />
            <StatCard title="Active Bot Users" value={viewStats.bots.activeUsers.toLocaleString()} icon={ShieldCheck} bgClass="bg-emerald-100" textClass="text-emerald-600" subtitle="Active users on active bots" secondaryLabel="Delivery Eligible" secondaryValue={(viewStats.bots.deliveryEligibleUsers || 0).toLocaleString()} />
            <StatCard title="Total Bot Users" value={viewStats.bots.totalUsers.toLocaleString()} icon={Activity} bgClass="bg-indigo-100" textClass="text-indigo-600" subtitle="All users across bots" />
            <StatCard title="Active Miniapps" value={(viewStats.miniapps?.active || 0).toLocaleString()} icon={Smartphone} bgClass="bg-amber-100" textClass="text-amber-600" subtitle="Approved and monetizing" />
            <StatCard title="Impressions Displayed Today" value={(viewStats.miniapps?.impressionsToday || 0).toLocaleString()} icon={Eye} bgClass="bg-red-100" textClass="text-red-600" secondaryLabel="Displayed Yesterday" secondaryValue={(viewStats.miniapps?.impressionsYesterday || 0).toLocaleString()} />
          </div>
        </div>

        {/* Conversion Analytics */}
        <div>
          <SectionHeader title="Conversion Analytics" icon={TrendingUp} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Conversions" value={Number(viewStats.conversions?.total || 0).toLocaleString()} icon={TrendingUp} bgClass="bg-purple-100" textClass="text-purple-600" />
            <StatCard title="Conversion Value" value={`$${Number(viewStats.conversions?.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={DollarSign} bgClass="bg-emerald-100" textClass="text-emerald-600" />
            <StatCard title="Review Queue" value={Number(viewStats.conversions?.open_reviews || 0).toLocaleString()} icon={AlertCircle} bgClass="bg-amber-100" textClass="text-amber-600" subtitle="Suspicious activity" />
            <StatCard title="Attribution Window" value={`${viewStats.conversions?.attribution_window_days || 7} days`} icon={Clock} bgClass="bg-blue-100" textClass="text-blue-600" />
          </div>
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[
              ["Top Campaigns", viewStats.conversions?.top_campaigns || [], (row: any) => `${row.campaign_type} #${row.campaign_id}`],
              ["Top Categories", viewStats.conversions?.top_categories || [], (row: any) => row.category],
              ["Top Inventory", viewStats.conversions?.top_inventory || [], (row: any) => `${row.inventory_type} #${row.inventory_id}`],
            ].map(([title, rows, labeler]: any) => (
              <div key={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
                {rows.length === 0 ? (
                  <p className="text-xs font-semibold text-slate-400">No conversion data yet.</p>
                ) : rows.map((row: any, index: number) => (
                  <div key={`${title}-${index}`} className="flex items-center justify-between border-t border-slate-100 py-2 text-sm first:border-t-0">
                    <span className="font-semibold text-slate-600">{labeler(row)}</span>
                    <span className="font-black text-slate-900">{Number(row.conversions || 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Trust and Safety */}
        <div>
          <SectionHeader title="Channel Trust & Safety" icon={ShieldCheck} href="/admin/withdrawals" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Fraud Coverage" value={`${Number(viewStats.trust_safety?.coverage_percent || 0).toFixed(1)}%`} icon={ShieldCheck} bgClass="bg-emerald-100" textClass="text-emerald-600" secondaryLabel="Never evaluated" secondaryValue={Number(viewStats.trust_safety?.never_evaluated_channels || 0).toLocaleString()} />
            <StatCard title="Stale Evaluations" value={Number(viewStats.trust_safety?.stale_evaluations || 0).toLocaleString()} icon={Clock} bgClass="bg-amber-100" textClass="text-amber-600" secondaryLabel="Oldest age" secondaryValue={viewStats.trust_safety?.oldest_evaluation_age_hours == null ? "N/A" : `${viewStats.trust_safety.oldest_evaluation_age_hours}h`} />
            <StatCard title="Manual Review" value={Number(viewStats.trust_safety?.withdrawals_requiring_manual_review || 0).toLocaleString()} icon={AlertCircle} bgClass="bg-red-100" textClass="text-red-600" secondaryLabel="Incomplete coverage" secondaryValue={Number(viewStats.trust_safety?.withdrawals_incomplete_fraud_coverage || 0).toLocaleString()} />
            <StatCard title="Ledger Gaps" value={Number(viewStats.trust_safety?.ledger_coverage_gaps || 0).toLocaleString()} icon={Activity} bgClass="bg-indigo-100" textClass="text-indigo-600" secondaryLabel="Cutover state" secondaryValue={String(viewStats.trust_safety?.ledger_classification || "unknown").replaceAll("_", " ")} />
            <StatCard title="High-risk Publishers" value={Number(viewStats.trust_safety?.high_risk_publishers || 0).toLocaleString()} icon={Users} bgClass="bg-rose-100" textClass="text-rose-600" secondaryLabel="Critical flags" secondaryValue={Number(viewStats.trust_safety?.unresolved_critical_flags || 0).toLocaleString()} />
            <StatCard title="GEO Conflicts / Stale" value={Number(viewStats.trust_safety?.geo_conflicts_or_stale || 0).toLocaleString()} icon={Tv} bgClass="bg-cyan-100" textClass="text-cyan-600" />
            <StatCard title="Traffic Alerts" value={Number(viewStats.trust_safety?.telemetry_concentration_alerts || 0).toLocaleString()} icon={AlertCircle} bgClass="bg-orange-100" textClass="text-orange-600" subtitle="Privacy-safe concentration signals, 7 days" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Campaigns */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><Megaphone size={18} className="text-purple-600" /> Campaigns</h3>
              <Link href="/admin/campaigns" className="text-xs font-semibold text-blue-600 hover:underline">Manage</Link>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-center gap-4">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-sm font-semibold flex items-center gap-2 text-amber-600"><Clock size={16}/> Pending Review</span>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6 text-[11px] font-semibold text-slate-500">
                    <span>Channel {Number(viewStats.campaigns.pending_by_type?.channel || 0)}</span>
                    <span>Bot {Number(viewStats.campaigns.pending_by_type?.bot || 0)}</span>
                    <span>Mini App {Number(viewStats.campaigns.pending_by_type?.miniapp || 0)}</span>
                  </div>
                </div>
                <span className="text-lg font-black">{viewStats.campaigns.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckCircle size={16}/> Active</span>
                <span className="text-lg font-black">{viewStats.campaigns.active}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-red-600"><XCircle size={16}/> Rejected</span>
                <span className="text-lg font-black">{viewStats.campaigns.rejected}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-500">Total Created</span>
                <span className="text-sm font-black text-slate-900">{viewStats.campaigns.total}</span>
              </div>
            </div>
          </div>

          {/* Channels */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><Tv size={18} className="text-blue-600" /> Channels</h3>
              <Link href="/admin/channels" className="text-xs font-semibold text-blue-600 hover:underline">Manage</Link>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-center gap-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-amber-600"><Clock size={16}/> Pending Approval</span>
                <span className="text-lg font-black">{viewStats.channels.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckCircle size={16}/> Approved</span>
                <span className="text-lg font-black">{viewStats.channels.approved}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-blue-600"><Activity size={16}/> Delivery Eligible</span>
                <span className="text-lg font-black">{viewStats.channels.deliveryEligible}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-red-600"><XCircle size={16}/> Rejected</span>
                <span className="text-lg font-black">{viewStats.channels.rejected}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-500">Aggregate Reach</span>
                <span className="text-sm font-black text-slate-900">{Number(viewStats.channels.approvedSubscribers || 0).toLocaleString()} subs</span>
              </div>
            </div>
          </div>

          {/* Withdrawals */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><CreditCard size={18} className="text-rose-600" /> Withdrawals</h3>
              <Link href="/admin/withdrawals" className="text-xs font-semibold text-blue-600 hover:underline">Manage</Link>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-center gap-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-amber-600"><Clock size={16}/> Pending Payout</span>
                <span className="text-lg font-black">{viewStats.withdrawals.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckCircle size={16}/> Successfully Paid</span>
                <span className="text-lg font-black">{viewStats.withdrawals.success}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-red-600"><XCircle size={16}/> Rejected</span>
                <span className="text-lg font-black">{viewStats.withdrawals.rejected}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-500">Total Requests</span>
                <span className="text-sm font-black text-slate-900">{viewStats.withdrawals.total}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  );
}
