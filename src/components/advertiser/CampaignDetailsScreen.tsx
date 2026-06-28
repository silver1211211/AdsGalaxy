"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { X, ExternalLink, Globe, DollarSign, Target, TrendingUp, Calendar, Type, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Campaign {
  id: number;
  name: string;
  type: string;
  status: string;
  budget: string | number;
  cpm: string | number;
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
  total_deliveries?: number;
  total_spent?: number;
  posts?: any[];
  broadcast_stats?: any[];
  chart_data?: any[];
  traffic_quality_rating?: string;
  inventory_quality_rating?: string;
}

interface CampaignDetailsScreenProps {
  campaign: Campaign;
  onClose: () => void;
}

import { apiFetch } from "@/lib/api";
import { Loader2, PlayCircle, Eye, MousePointer2, Send, Bot } from "lucide-react";

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

export default function CampaignDetailsScreen({ campaign: initialCampaign, onClose }: CampaignDetailsScreenProps) {
  const [campaign, setCampaign] = React.useState<Campaign>(initialCampaign);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchFullDetails = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/advertiser/campaigns/${initialCampaign.id}`);
      const data = await res.json();
      if (res.ok) setCampaign(data);
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
        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <DollarSign size={10} /> Budget
            </p>
            <p className="text-lg font-black text-slate-900">${campaign.budget}</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <TrendingUp size={10} /> CPM
            </p>
            <p className="text-lg font-black text-slate-900">${campaign.cpm}</p>
          </div>
          {campaign.type === 'broadcast' ? (
            <>
              <div className="p-4 bg-[#0c9de8]/5 rounded-3xl border border-[#0c9de8]/10 space-y-1">
                <p className="text-[10px] font-bold text-[#0c9de8] uppercase tracking-widest flex items-center gap-1.5">
                  <Send size={10} /> Total Sent
                </p>
                <p className="text-lg font-black text-slate-900">
                  {isLoading ? <Loader2 className="animate-spin" size={16} /> : campaign.total_deliveries || 0}
                </p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-3xl border border-emerald-100 space-y-1">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1.5">
                  <DollarSign size={10} /> Total Spent
                </p>
                <p className="text-lg font-black text-slate-900">
                  {isLoading ? <Loader2 className="animate-spin" size={16} /> : `$${parseFloat(campaign.total_spent as any || "0").toFixed(4)}`}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-[#0c9de8]/5 rounded-3xl border border-[#0c9de8]/10 space-y-1">
                <p className="text-[10px] font-bold text-[#0c9de8] uppercase tracking-widest flex items-center gap-1.5">
                  <MousePointer2 size={10} /> Clicks
                </p>
                <p className="text-lg font-black text-slate-900">
                  {isLoading ? <Loader2 className="animate-spin" size={16} /> : campaign.total_clicks || 0}
                </p>
              </div>
              <div className="p-4 bg-indigo-50 rounded-3xl border border-indigo-100 space-y-1">
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Eye size={10} /> Views
                </p>
                <p className="text-lg font-black text-slate-900">
                  {isLoading ? <Loader2 className="animate-spin" size={16} /> : campaign.total_views || 0}
                </p>
              </div>
            </>
          )}
          <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Target size={10} /> Goal
            </p>
            <p className="text-lg font-black text-slate-900 uppercase">{campaign.type}</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <AlertTriangle size={10} /> Traffic Quality
            </p>
            <p className="text-sm font-black text-slate-900">{campaign.traffic_quality_rating || "Good"}</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <AlertTriangle size={10} /> Inventory Quality
            </p>
            <p className="text-sm font-black text-slate-900">{campaign.inventory_quality_rating || "Good"}</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Calendar size={10} /> Created
            </p>
            <p className="text-sm font-black text-slate-900 truncate">{new Date(campaign.created_at).toLocaleDateString()}</p>
          </div>
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
                  {campaign.message_text}
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
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="animate-spin text-[#0c9de8]" size={32} />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading performance data...</p>
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
                            {stat.delivery_count} Messages
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
                  <div className="text-center py-12 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No broadcasts yet</p>
                    <p className="text-[8px] font-bold text-slate-300 uppercase mt-1 tracking-wider">Campaign waiting for next distribution cycle</p>
                  </div>
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
                <div className="text-center py-12 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No posts yet</p>
                  <p className="text-[8px] font-bold text-slate-300 uppercase mt-1 tracking-wider">Campaign waiting for next distribution cycle</p>
                </div>
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
