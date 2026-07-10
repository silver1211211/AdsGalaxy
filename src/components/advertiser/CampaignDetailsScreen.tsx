"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { X, ExternalLink, Globe, DollarSign, Target, TrendingUp, Calendar, AlertTriangle, PieChart, PlayCircle, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { Eye, MousePointer2, Send, Bot } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { composeCampaignCreativeText } from "@/lib/campaignCreative";

interface Campaign {
  id: number;
  name: string;
  kind?: "channel" | "bot" | "miniapp";
  type: string;
  status: string;
  budget: string | number;
  cpm: string | number;
  campaign_title?: string | null;
  message_text: string;
  image_url: string | null;
  link: string;
  button_text: string;
  category: string;
  continents: string;
  countries?: string | null;
  languages?: string | null;
  vpn_policy?: string | null;
  device_policy?: string | null;
  os_policy?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  daily_budget_limit?: string | number | null;
  frequency_cap_per_user?: string | number | null;
  created_at: string;
  total_clicks?: number;
  total_views?: number;
  impressions?: number;
  clicks?: number;
  spend?: number;
  ctr?: number;
  total_deliveries?: number;
  total_spent?: number;
  posts?: any[];
  broadcast_stats?: any[];
  chart_data?: Array<{ date: string; count: number }>;
  traffic_quality_rating?: string;
  inventory_quality_rating?: string;
}

interface CampaignDetailsScreenProps {
  campaign: Campaign;
  onClose: () => void;
}

function targetingList(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "All";
  if (!value) return "All";
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return parsed.length > 0 ? parsed.join(", ") : "All";
  } catch {
    // Plain strings are displayed directly.
  }
  return String(value) || "All";
}

function policyLabel(value: unknown) {
  const labels: Record<string, string> = {
    allow_all: "Allow all traffic",
    prefer_non_vpn: "Prefer non-VPN traffic",
    exclude_vpn: "Exclude VPN/proxy traffic",
    all: "All",
    mobile: "Mobile only",
    desktop: "Desktop only",
    android: "Android",
    ios: "iOS",
    desktop_web: "Desktop/Web",
  };
  return labels[String(value || "all")] || "All";
}

function shortDate(value: unknown) {
  if (!value) return "No restriction";
  return new Date(String(value)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "—";
}

function computeCtr(campaign: Campaign) {
  if (campaign.kind === "miniapp" && campaign.ctr !== undefined) return Number(campaign.ctr);
  const clicks = Number(campaign.total_clicks ?? campaign.clicks ?? 0);
  const views = Number(campaign.total_views ?? campaign.impressions ?? 0);
  if (views <= 0) return null;
  return (clicks / views) * 100;
}

function computeCpc(campaign: Campaign) {
  if (campaign.type !== "clicks") return null;
  const cpm = Number(campaign.cpm || 0);
  if (!Number.isFinite(cpm) || cpm <= 0) return null;
  return cpm / 1000;
}

function computeProgress(campaign: Campaign) {
  if (campaign.type !== "broadcast") return null;
  const remaining = Number(campaign.budget || 0);
  const spent = Number(campaign.total_spent || 0);
  const original = remaining + spent;
  if (original <= 0) return null;
  return Math.min(100, (spent / original) * 100);
}

function StatCard({ icon: Icon, label, value, tone = "slate" }: {
  icon: React.ElementType; label: string; value: React.ReactNode;
  tone?: "slate" | "blue" | "emerald" | "indigo";
}) {
  const toneClasses = {
    slate: "bg-slate-50 border-slate-100 text-slate-400",
    blue: "bg-[#0c9de8]/5 border-[#0c9de8]/10 text-[#0c9de8]",
    emerald: "bg-emerald-50 border-emerald-100 text-emerald-600",
    indigo: "bg-indigo-50 border-indigo-100 text-indigo-400",
  }[tone];
  return (
    <div className={cn("space-y-1 rounded-3xl border p-4", toneClasses)}>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
        <Icon size={10} /> {label}
      </p>
      <p className="text-lg font-black text-slate-900">{value}</p>
    </div>
  );
}

function MiniBarChart({ data, color, label }: { data: Array<{ date: string; count: number }>; color: string; label: string }) {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={PieChart}
        title="No recent activity"
        message="This chart will fill in once daily activity is recorded."
        variant="compact"
      />
    );
  }
  const max = Math.max(1, ...data.map((point) => Number(point.count) || 0));
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <div className="flex h-24 items-end gap-1.5">
        {data.map((point, index) => {
          const value = Number(point.count) || 0;
          const heightPct = Math.max(6, (value / max) * 100);
          return (
            <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[9px] font-black text-slate-500">{value}</span>
              <div className="flex w-full flex-1 items-end">
                <div className="w-full rounded-t-md" style={{ height: `${heightPct}%`, backgroundColor: color }} />
              </div>
              <span className="text-[8px] font-bold text-slate-400">
                {new Date(point.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignDetailsScreen({ campaign: initialCampaign, onClose }: CampaignDetailsScreenProps) {
  const [campaign, setCampaign] = React.useState<Campaign>(initialCampaign);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchFullDetails = async () => {
    setIsLoading(true);
    try {
      const endpoint = initialCampaign.kind === "miniapp"
        ? `/api/advertiser/miniapp-rewarded-campaigns/${initialCampaign.id}`
        : `/api/advertiser/campaigns/${initialCampaign.id}`;
      const res = await apiFetch(endpoint);
      const data = await res.json();
      if (res.ok) {
        setCampaign(initialCampaign.kind === "miniapp"
          ? {
            ...initialCampaign,
            ...data,
            name: data.campaign_name || initialCampaign.name,
            type: "rewarded",
            campaign_title: data.title || initialCampaign.campaign_title || data.campaign_name || initialCampaign.name,
            message_text: data.description || "",
            button_text: data.cta_text || "",
            link: data.landing_url || "",
            cpm: data.advertiser_cpm_bid || initialCampaign.cpm,
            budget: data.remaining_budget ?? data.budget ?? initialCampaign.budget,
            total_views: Number(data.impressions || initialCampaign.impressions || 0),
            total_clicks: Number(data.clicks || initialCampaign.clicks || 0),
            total_spent: Number(data.spend || initialCampaign.spend || 0),
          }
          : data);
      }
    } catch (err) {
      console.error("Fetch Details Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFullDetails();
    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) {
      webapp.BackButton.show();
      webapp.BackButton.onClick(onClose);
      return () => {
        webapp.BackButton.hide();
        webapp.BackButton.offClick(onClose);
      };
    }
  }, [onClose]);

  const continents = JSON.parse(campaign.continents || "[]");
  const ctr = computeCtr(campaign);
  const cpc = computeCpc(campaign);
  const progress = computeProgress(campaign);
  const spentDisplay = campaign.type === "broadcast" || campaign.kind === "miniapp"
    ? formatMoney(campaign.total_spent ?? campaign.spend)
    : "—";

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 top-16 z-[40] bg-white flex flex-col h-[calc(100vh-64px)] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-slate-50">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight truncate max-w-[200px] sm:max-w-md">
              {campaign.name}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Campaign Details</p>
          </div>
        </div>
        <div className={cn(
          "px-3 py-1.5 rounded-full text-[10px] font-black uppercase border",
          campaign.status === "active" ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
            campaign.status === "paused" ? "bg-amber-50 text-amber-600 border-amber-100" :
              "bg-blue-50 text-blue-600 border-blue-100"
        )}>
          {campaign.status}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Budget Overview */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Budget Overview</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard icon={DollarSign} label="Remaining Budget" value={`$${campaign.budget}`} />
            <StatCard icon={DollarSign} label="Spent" value={spentDisplay} tone="emerald" />
            <StatCard icon={TrendingUp} label="CPM" value={`$${campaign.cpm}`} tone="blue" />
            <StatCard icon={TrendingUp} label="CPC" value={cpc !== null ? `$${cpc.toFixed(4)}` : "—"} tone="indigo" />
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Progress</p>
              <p className="text-xs font-black text-slate-700">{progress !== null ? `${progress.toFixed(0)}% spent` : "Not enough data yet"}</p>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn("h-full rounded-full transition-all", progress !== null ? "bg-[#0c9de8]" : "bg-slate-300")}
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Performance</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {campaign.kind === "miniapp" ? (
              <>
                <StatCard
                  icon={Eye}
                  label="Impressions"
                  tone="indigo"
                  value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : Number(campaign.total_views ?? campaign.impressions ?? 0).toLocaleString()}
                />
                <StatCard
                  icon={MousePointer2}
                  label="Clicks"
                  tone="blue"
                  value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : Number(campaign.total_clicks ?? campaign.clicks ?? 0).toLocaleString()}
                />
                <StatCard
                  icon={TrendingUp}
                  label="CTR"
                  value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : (ctr !== null ? `${ctr.toFixed(2)}%` : "—")}
                />
              </>
            ) : campaign.type === 'broadcast' ? (
              <>
                <StatCard icon={Eye} label="Impressions" tone="indigo" value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : Number(campaign.total_deliveries || 0).toLocaleString()} />
                <StatCard icon={DollarSign} label="Spend" tone="emerald" value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : `$${Number(campaign.total_spent || 0).toFixed(4)}`} />
                <StatCard icon={TrendingUp} label="Effective CPM" value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : (Number(campaign.total_deliveries || 0) > 0 ? `$${(Number(campaign.total_spent || 0) / Number(campaign.total_deliveries || 0) * 1000).toFixed(4)}` : "—")} />
              </>
            ) : (
              <>
                <StatCard
                  icon={Eye}
                  label="Views"
                  tone="indigo"
                  value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : campaign.total_views || 0}
                />
                <StatCard
                  icon={MousePointer2}
                  label="Clicks"
                  tone="blue"
                  value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : campaign.total_clicks || 0}
                />
                <StatCard
                  icon={TrendingUp}
                  label="CTR"
                  value={isLoading ? <SkeletonBlock className="h-6 w-10" /> : (ctr !== null ? `${ctr.toFixed(2)}%` : "—")}
                />
              </>
            )}
            <StatCard icon={Target} label="Goal" value={<span className="uppercase">{campaign.type}</span>} />
            <StatCard icon={AlertTriangle} label="Traffic Quality" value={<span className="text-sm">{campaign.traffic_quality_rating || "Good"}</span>} />
            <StatCard icon={AlertTriangle} label="Inventory Quality" value={<span className="text-sm">{campaign.inventory_quality_rating || "Good"}</span>} />
          </div>
        </div>

        {/* Schedule */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Schedule</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard icon={Calendar} label="Created" value={<span className="text-sm">{new Date(campaign.created_at).toLocaleDateString()}</span>} />
            <StatCard icon={Calendar} label="Start Date" value={<span className="text-sm">{campaign.start_at ? new Date(campaign.start_at).toLocaleDateString() : "Immediate"}</span>} />
            <StatCard icon={Calendar} label="End Date" value={<span className="text-sm">{campaign.end_at ? new Date(campaign.end_at).toLocaleDateString() : "No end date"}</span>} />
            <StatCard icon={Rocket} label="Est. Completion" value={<span className="text-sm">Not enough data yet</span>} />
          </div>
        </div>

        {/* Recent Activity Chart */}
        <div className="space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
            {campaign.type === "broadcast" ? "Daily Impressions (7 Days)" : "Daily Clicks (7 Days)"}
          </h3>
          {isLoading ? (
            <SkeletonBlock className="h-32 w-full" />
          ) : (
            <MiniBarChart
              data={campaign.chart_data || []}
              color="#0c9de8"
              label={campaign.type === "broadcast" ? "Impressions per day" : "Clicks per day"}
            />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Ad Preview */}
          <div className="space-y-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Live Preview</h3>
            <div className="bg-slate-100/60 rounded-[2.5rem] p-6 border border-slate-200 shadow-inner space-y-4">
              {campaign.image_url && (
                <img
                  src={campaign.image_url}
                  alt="Ad"
                  className="w-full aspect-video object-cover rounded-2xl shadow-sm border border-slate-200/50"
                />
              )}
              <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-200/50 min-h-[100px]">
                <p className="text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {composeCampaignCreativeText(campaign.campaign_title, campaign.message_text)}
                </p>
              </div>
              <div className="w-full py-4 bg-[#0c9de8] text-white rounded-2xl font-black uppercase text-xs tracking-widest flex items-center justify-center gap-2 shadow-md shadow-[#0c9de8]/20">
                {campaign.button_text} <ExternalLink size={14} />
              </div>
            </div>
          </div>

          {/* Performance & Channels */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Posts History</h3>
              {campaign.posts && (
                <span className="text-[10px] font-black text-[#0c9de8] uppercase tracking-widest bg-blue-50 px-2 py-1 rounded-lg">
                  {campaign.posts.length} Placements
                </span>
              )}
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200">
              {isLoading ? (
                <div className="space-y-3">
                  <SkeletonBlock className="h-20 w-full" />
                  <SkeletonBlock className="h-20 w-full" />
                  <SkeletonBlock className="h-20 w-full" />
                </div>
              ) : campaign.type === 'broadcast' ? (
                campaign.broadcast_stats && campaign.broadcast_stats.length > 0 ? (
                  campaign.broadcast_stats.map((stat: any, idx: number) => (
                    <div key={idx} className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-2xl hover:bg-white hover:shadow-md hover:border-[#0c9de8]/40 transition-all group">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-400 group-hover:bg-indigo-100 transition-colors">
                            <Bot size={20} />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 truncate max-w-[150px]">
                              {stat.bot_name}
                            </p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              @{stat.bot_username}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <Send size={12} className="text-blue-500" />
                          <span className="text-[10px] font-black text-slate-600">
                            {stat.delivery_count} Impressions
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 ml-auto pr-2">
                          <DollarSign size={12} className="text-emerald-500" />
                          <span className="text-[10px] font-black text-emerald-600">
                            ${parseFloat(stat.total_spent || "0").toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState icon={Send} title="No broadcasts yet" message="Campaign waiting for its next distribution cycle." variant="compact" />
                )
              ) : campaign.posts && campaign.posts.length > 0 ? (
                campaign.posts.map((post: any) => (
                  <div key={post.id} className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-2xl hover:bg-white hover:shadow-md hover:border-[#0c9de8]/40 transition-all group">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-[#0c9de8] transition-colors">
                          <PlayCircle size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900 truncate max-w-[150px]">
                            {post.channel_title}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            Channel placement • ID: #{post.id}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {new Date(post.created_at).toLocaleDateString()}
                        </p>
                        <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">
                          {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 pt-3 border-t border-slate-50">
                      <div className="flex items-center gap-1.5">
                        <Eye size={12} className={cn("text-slate-300", post.invalid_audit_count > 0 && "text-amber-500")} />
                        <span className={cn("text-[10px] font-black text-slate-600", post.invalid_audit_count > 0 && "text-amber-600")}>
                          {post.views || 0}
                          {post.invalid_audit_count > 0 && " (Suspected)"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MousePointer2 size={12} className="text-slate-300" />
                        <span className="text-[10px] font-black text-slate-600">
                          {post.post_clicks || 0} clicks
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 ml-auto pr-2">
                        <DollarSign size={12} className="text-emerald-500" />
                        <span className="text-[10px] font-black text-emerald-600">
                          ${parseFloat(post.total_paid || "0").toFixed(4)}
                        </span>
                      </div>
                      <div className="flex-shrink-0">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[8px] font-black uppercase",
                          post.status === 'active' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                        )}>
                          {post.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState icon={PlayCircle} title="No posts yet" message="Campaign waiting for its next distribution cycle." variant="compact" />
              )}
            </div>

            <div className="space-y-4 pt-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Configuration</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-4 p-4 bg-slate-50/80 border border-slate-200/60 rounded-2xl shadow-sm">
                  <Globe size={18} className="text-blue-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Targeting</p>
                    <p className="text-sm font-black text-slate-900 truncate">
                      {continents.length === 7 ? "Global" : continents.join(", ")}
                    </p>
                  </div>
                </div>
                <div className="p-4 bg-slate-50/80 border border-slate-200/60 rounded-2xl shadow-sm space-y-3">
                  <div className="flex items-center gap-4">
                    <Target size={18} className="text-emerald-500" />
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Selected Targeting</p>
                      <p className="text-sm font-black text-slate-900">Countries: {targetingList(campaign.countries)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 pl-9 text-xs font-bold text-slate-500 sm:grid-cols-2">
                    <div>Languages: {targetingList(campaign.languages)}</div>
                    <div>VPN: {policyLabel(campaign.vpn_policy)}</div>
                    <div>Device: {policyLabel(campaign.device_policy)}</div>
                    <div>Platform: {policyLabel(campaign.os_policy)}</div>
                    <div>Start: {shortDate(campaign.start_at)}</div>
                    <div>End: {shortDate(campaign.end_at)}</div>
                    <div>Daily cap: {campaign.daily_budget_limit ? `$${campaign.daily_budget_limit}` : "No cap"}</div>
                    <div>Frequency cap: {campaign.frequency_cap_per_user || "No cap"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-slate-50/80 border border-slate-200/60 rounded-2xl shadow-sm">
                  <ExternalLink size={18} className="text-[#0c9de8]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Destination</p>
                    <a href={campaign.link} target="_blank" className="text-sm font-black text-[#0c9de8] hover:underline truncate block">
                      {campaign.link}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
