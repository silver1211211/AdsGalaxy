"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, Users, Megaphone, Tv, CreditCard, DollarSign, Activity, AlertCircle, CheckCircle, Clock, XCircle, TrendingUp, Bot, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStats(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="animate-spin text-blue-600" size={32} />
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="rounded-lg bg-red-50 p-4 text-red-600 border border-red-200">
          <p className="font-bold">Error loading dashboard</p>
          <p className="text-sm">{error}</p>
        </div>
      </AdminLayout>
    );
  }

  const StatCard = ({ title, value, icon: Icon, bgClass, textClass, subtitle }: any) => (
    <div className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between`}>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</p>
        <h3 className="text-2xl font-black text-slate-900">{value}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-1 font-medium">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-lg ${bgClass} flex-shrink-0`}>
        <Icon size={24} className={textClass} />
      </div>
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

      <div className="space-y-8">
        
        {/* User Growth */}
        <div>
          <SectionHeader title="User Growth" icon={Users} href="/admin/users" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Users" value={stats.users.total} icon={Users} bgClass="bg-blue-100" textClass="text-blue-600" />
            <StatCard title="New Today" value={`+${stats.users.today}`} icon={TrendingUp} bgClass="bg-emerald-100" textClass="text-emerald-600" />
            <StatCard title="New This Week" value={`+${stats.users.week}`} icon={Activity} bgClass="bg-emerald-100" textClass="text-emerald-600" subtitle="Last 7 Days" />
            <StatCard title="New This Month" value={`+${stats.users.month}`} icon={Activity} bgClass="bg-indigo-100" textClass="text-indigo-600" subtitle="Last 30 Days" />
          </div>
        </div>

        {/* Financials Overview */}
        <div>
          <SectionHeader title="Financials Overview" icon={DollarSign} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm font-bold text-emerald-800 uppercase tracking-wide">Total Processed Deposits</p>
                <h3 className="text-3xl font-black text-emerald-900 mt-1">${parseFloat(stats.financials.totalDeposits).toLocaleString('en-US', {minimumFractionDigits: 2})}</h3>
              </div>
              <Wallet className="text-emerald-500 opacity-50" size={48} />
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-sm font-bold text-orange-800 uppercase tracking-wide">Total Paid Withdrawals</p>
                <h3 className="text-3xl font-black text-orange-900 mt-1">${parseFloat(stats.financials.totalWithdrawals).toLocaleString('en-US', {minimumFractionDigits: 2})}</h3>
              </div>
              <CreditCard className="text-orange-500 opacity-50" size={48} />
            </div>
          </div>
        </div>

        {/* Network Reach */}
        <div>
          <SectionHeader title="Network Reach" icon={Activity} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Subscribers" value={stats.channels.totalSubscribers.toLocaleString()} icon={Users} bgClass="bg-blue-100" textClass="text-blue-600" subtitle="Across all active channels" />
            <StatCard title="Monetized Bots" value={stats.bots.total} icon={Bot} bgClass="bg-purple-100" textClass="text-purple-600" subtitle="Active in network" />
            <StatCard title="Active Bot Users" value={stats.bots.activeUsers.toLocaleString()} icon={ShieldCheck} bgClass="bg-emerald-100" textClass="text-emerald-600" subtitle="Users receiving ads" />
            <StatCard title="Total Bot Users" value={stats.bots.totalUsers.toLocaleString()} icon={Activity} bgClass="bg-indigo-100" textClass="text-indigo-600" subtitle="All users across bots" />
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
                <span className="text-sm font-semibold flex items-center gap-2 text-amber-600"><Clock size={16}/> Pending Review</span>
                <span className="text-lg font-black">{stats.campaigns.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckCircle size={16}/> Active</span>
                <span className="text-lg font-black">{stats.campaigns.active}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-red-600"><XCircle size={16}/> Rejected</span>
                <span className="text-lg font-black">{stats.campaigns.rejected}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-500">Total Created</span>
                <span className="text-sm font-black text-slate-900">{stats.campaigns.total}</span>
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
                <span className="text-lg font-black">{stats.channels.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckCircle size={16}/> Approved</span>
                <span className="text-lg font-black">{stats.channels.approved}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-red-600"><XCircle size={16}/> Rejected</span>
                <span className="text-lg font-black">{stats.channels.rejected}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-500">Aggregate Reach</span>
                <span className="text-sm font-black text-slate-900">{stats.channels.totalSubscribers.toLocaleString()} subs</span>
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
                <span className="text-lg font-black">{stats.withdrawals.pending}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-emerald-600"><CheckCircle size={16}/> Successfully Paid</span>
                <span className="text-lg font-black">{stats.withdrawals.success}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold flex items-center gap-2 text-red-600"><XCircle size={16}/> Rejected</span>
                <span className="text-lg font-black">{stats.withdrawals.rejected}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-500">Total Requests</span>
                <span className="text-sm font-black text-slate-900">{stats.withdrawals.total}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  );
}

// Just adding Wallet icon since it wasn't imported from lucide-react in the top import initially
function Wallet(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
}
