"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertTriangle, Check, Edit3, Loader2, Pause, Play, X } from "lucide-react";

const MINIAPP_CREATIVE_CATEGORIES = [
  "General",
  "Utilities",
  "Education",
  "AI",
  "Gaming",
  "Finance",
  "Crypto",
  "Trading",
  "Shopping",
  "Entertainment",
  "Other",
];

type Campaign = {
  id: number;
  campaign_name: string;
  title: string;
  description?: string;
  image_url?: string | null;
  landing_url?: string | null;
  cta_text?: string | null;
  title_color?: string | null;
  body_color?: string | null;
  categories?: string | string[] | null;
  required_cpm?: string | number;
  creative_review_status?: string | null;
  creative_review_notes?: string | null;
  landing_review_flags?: string | string[] | null;
  image_review_metadata?: string | Record<string, unknown> | null;
  advertiser_id: number;
  username?: string | null;
  first_name?: string | null;
  advertiser_trust_level?: string | null;
  advertiser_total_spend?: string | number;
  advertiser_approved_campaigns?: string | number;
  advertiser_rejected_campaigns?: string | number;
  status: string;
  budget: string | number;
  remaining_budget: string | number;
  advertiser_cpm_bid?: string | number;
  admin_cpm: string | number;
  cpm_mode?: string | null;
  fixed_publisher_cpm?: string | number | null;
  campaign_budget_mode?: string | null;
  daily_budget_mode?: string | null;
  impressions: string | number;
  spend: string | number;
  publisher_revenue?: string | number;
  ads_galaxy_revenue?: string | number;
  reserve_revenue?: string | number;
  avg_quality_factor?: string | number;
  quality_score?: string | number;
  quality_tier?: string | null;
  target_countries?: string | null;
  countries?: string | string[] | null;
  languages?: string | string[] | null;
  vpn_policy?: string | null;
  device_policy?: string | null;
  os_policy?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  daily_budget_limit?: string | number | null;
  frequency_cap_per_user?: string | number | null;
};

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function listValue(value: unknown) {
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

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function imageMetaText(value: unknown) {
  if (!value) return "Not inspected";
  try {
    const meta = typeof value === "string" ? JSON.parse(value) : value as Record<string, unknown>;
    const kb = Number(meta.bytes || 0) > 0 ? `${(Number(meta.bytes) / 1024).toFixed(0)}KB` : "size n/a";
    return `${meta.type || "image"} ${meta.width || "?"}x${meta.height || "?"}, ${kb}`;
  } catch {
    return "Not inspected";
  }
}

function policyValue(value: unknown) {
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

function scheduleValue(start?: string | null, end?: string | null) {
  const startText = start ? new Date(start).toLocaleDateString() : "Any start";
  const endText = end ? new Date(end).toLocaleDateString() : "No end";
  return `${startText} – ${endText}`;
}

export default function AdminMiniAppRewardedPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [cpms, setCpms] = useState<Record<number, string>>({});
  const [cpmModes, setCpmModes] = useState<Record<number, string>>({});
  const [fixedCpms, setFixedCpms] = useState<Record<number, string>>({});
  const [categoryAdjustments, setCategoryAdjustments] = useState<Record<string, number>>({});
  const [moderationNotes, setModerationNotes] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editCats, setEditCats] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/miniapp-rewarded-campaigns");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load campaigns");
      setCampaigns(data.campaigns || []);
      setCategoryAdjustments(data.category_adjustments || {});
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const runAction = async (id: number, action: string) => {
    setMessage("");
    try {
      const campaign = campaigns.find((item) => item.id === id);
      const res = await fetch("/api/admin/miniapp-rewarded-campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action,
          admin_cpm: cpms[id] ?? campaign?.admin_cpm ?? campaign?.advertiser_cpm_bid,
          cpm_mode: cpmModes[id] ?? campaign?.cpm_mode ?? "live",
          fixed_publisher_cpm: fixedCpms[id] ?? campaign?.fixed_publisher_cpm ?? "",
          moderation_notes: moderationNotes[id] || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      setMessage("Campaign updated.");
      await fetchCampaigns();
    } catch (error: any) {
      setMessage(error.message);
    }
  };

  const updateCategoryAdjustment = async (category: string, value: string) => {
    try {
      const numeric = Number(value);
      const res = await fetch("/api/admin/miniapp-rewarded-campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_category_adjustment", category, value: numeric }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update category adjustment");
      setCategoryAdjustments(data.category_adjustments || {});
      setMessage("Category adjustment updated.");
    } catch (error: any) {
      setMessage(error.message);
    }
  };

  const openEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setEditCats(parseList(campaign.categories));
    setEditForm({
      campaign_name: campaign.campaign_name || "",
      title: campaign.title || "",
      description: String(campaign.description || ""),
      image_url: String(campaign.image_url || ""),
      landing_url: String(campaign.landing_url || ""),
      cta_text: String(campaign.cta_text || ""),
      title_color: String(campaign.title_color || ""),
      body_color: String(campaign.body_color || ""),
      countries: parseList(campaign.countries || campaign.target_countries).join(", "),
      languages: parseList(campaign.languages).join(", "),
      vpn_policy: String(campaign.vpn_policy || "allow_all"),
      device_policy: String(campaign.device_policy || "all"),
      os_policy: String(campaign.os_policy || "all"),
      start_at: campaign.start_at ? new Date(campaign.start_at).toISOString().slice(0, 10) : "",
      end_at: campaign.end_at ? new Date(campaign.end_at).toISOString().slice(0, 10) : "",
      daily_budget_limit: String(campaign.daily_budget_limit || ""),
      frequency_cap_per_user: String(campaign.frequency_cap_per_user || ""),
    });
  };

  const handleEditSubmit = async () => {
    if (!editingCampaign) return;
    setEditLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/miniapp-rewarded-campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingCampaign.id,
          action: "edit",
          ...editForm,
          categories: editCats,
          countries: editForm.countries ? editForm.countries.split(",").map((s) => s.trim()).filter(Boolean) : [],
          languages: editForm.languages ? editForm.languages.split(",").map((s) => s.trim()).filter(Boolean) : [],
          daily_budget_limit: editForm.daily_budget_limit || null,
          frequency_cap_per_user: editForm.frequency_cap_per_user || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Edit failed");
      setMessage("Campaign updated.");
      setEditingCampaign(null);
      await fetchCampaigns();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setEditLoading(false);
    }
  };

  const ef = (field: string, value: string) => setEditForm((prev) => ({ ...prev, [field]: value }));

  const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300";

  return (
    <AdminLayout>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Rewarded Ad Campaigns</h1>
          <p className="mt-0.5 text-sm text-slate-500">Review and manage mini app rewarded ad campaigns</p>
        </div>
        {message && (
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${message.includes("failed") || message.includes("Failed") ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {message}
          </span>
        )}
      </div>

      {/* Category CPM Adjustments */}
      <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Category CPM Adjustments</h2>
          <p className="mt-0.5 text-xs text-slate-500">Override CPM multipliers per creative category</p>
        </div>
        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {MINIAPP_CREATIVE_CATEGORIES.map((category) => (
              <div key={category} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1.5 text-xs font-semibold text-slate-700">{category}</div>
                <input
                  defaultValue={Number(categoryAdjustments[category] || 0).toFixed(2)}
                  onBlur={(e) => updateCategoryAdjustment(category, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">All Campaigns</h2>
        </div>
        {loading ? (
          <div className="p-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Creative</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Advertiser</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Budget</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Impressions</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Revenue</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Targeting</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Review</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">CPM Controls</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="transition-colors hover:bg-slate-50/80">
                    {/* Creative */}
                    <td className="px-4 py-4">
                      <div className="flex gap-3">
                        {campaign.image_url
                          ? <img src={campaign.image_url} alt={campaign.title} className="h-20 w-20 flex-shrink-0 rounded-lg border border-slate-200 object-cover" />
                          : <div className="h-20 w-20 flex-shrink-0 rounded-lg border border-slate-200 bg-slate-50" />
                        }
                        <div className="min-w-0 max-w-[240px]">
                          <div className="font-semibold text-slate-900">{campaign.campaign_name}</div>
                          <div className="mt-0.5 text-xs font-bold" style={{ color: campaign.title_color || undefined }}>{campaign.title}</div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-slate-500" style={{ color: campaign.body_color || undefined }}>{campaign.description}</div>
                          <a href={campaign.landing_url || "#"} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs font-semibold text-blue-700 hover:text-blue-900">{campaign.landing_url}</a>
                          <div className="mt-0.5 text-xs text-slate-500">CTA: <span className="font-bold text-slate-800">{campaign.cta_text || "Learn More"}</span></div>
                        </div>
                      </div>
                    </td>

                    {/* Advertiser */}
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{campaign.username ? `@${campaign.username}` : campaign.first_name || `User #${campaign.advertiser_id}`}</div>
                      <div className="mt-0.5 text-xs capitalize text-slate-500">Trust: {campaign.advertiser_trust_level || "new"}</div>
                      <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                        <div>Spend {money(campaign.advertiser_total_spend)}</div>
                        <div>Approved {campaign.advertiser_approved_campaigns || 0} / Rejected {campaign.advertiser_rejected_campaigns || 0}</div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${
                        campaign.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : campaign.status === "paused" ? "border-amber-200 bg-amber-50 text-amber-700"
                        : campaign.status === "rejected" ? "border-red-200 bg-red-50 text-red-700"
                        : "border-slate-200 bg-slate-100 text-slate-600"
                      }`}>{campaign.status}</span>
                      <div className="mt-1.5 text-xs text-slate-500">Review: {campaign.creative_review_status || "pending"}</div>
                    </td>

                    {/* Budget */}
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{campaign.campaign_budget_mode === "unlimited" ? "Unlimited" : money(campaign.budget)}</div>
                      <div className="mt-0.5 text-xs text-slate-500">Left {campaign.campaign_budget_mode === "unlimited" ? "Balance funded" : money(campaign.remaining_budget)}</div>
                      <div className="text-xs text-slate-500">Bid {money(campaign.advertiser_cpm_bid)}</div>
                    </td>

                    {/* Impressions */}
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{numberValue(campaign.impressions)}</div>
                    </td>

                    {/* Revenue */}
                    <td className="px-4 py-4">
                      <div className="space-y-0.5 text-xs">
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Advertiser</span><span className="font-medium text-slate-900">{money(campaign.spend)}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Publisher</span><span className="font-medium text-slate-900">{money(campaign.publisher_revenue)}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">AdsGalaxy</span><span className="font-medium text-slate-900">{money(campaign.ads_galaxy_revenue)}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Reserve</span><span className="font-medium text-slate-900">{money(campaign.reserve_revenue)}</span></div>
                        <div className="mt-1 border-t border-slate-100 pt-1 text-[10px] text-slate-400">
                          Avg Q: {Number(campaign.avg_quality_factor || 0).toFixed(4)} · Score: {campaign.quality_score || 50} / {campaign.quality_tier || "avg"}
                        </div>
                      </div>
                    </td>

                    {/* Targeting */}
                    <td className="px-4 py-4">
                      <div className="space-y-0.5 text-xs">
                        <div><span className="text-slate-500">Countries: </span><span className="text-slate-700">{listValue(campaign.countries || campaign.target_countries)}</span></div>
                        <div><span className="text-slate-500">Categories: </span><span className="text-slate-700">{listValue(campaign.categories)}</span></div>
                        <div><span className="text-slate-500">Languages: </span><span className="text-slate-700">{listValue(campaign.languages)}</span></div>
                        <div className="text-slate-500">{policyValue(campaign.vpn_policy)} · {policyValue(campaign.device_policy)} · {policyValue(campaign.os_policy)}</div>
                        <div className="text-slate-500">{scheduleValue(campaign.start_at, campaign.end_at)}</div>
                        <div className="text-slate-500">Daily: {campaign.daily_budget_limit ? money(campaign.daily_budget_limit) : "No cap"} · Freq: {campaign.frequency_cap_per_user || "No cap"}</div>
                      </div>
                    </td>

                    {/* Review */}
                    <td className="px-4 py-4">
                      <div className="space-y-0.5 text-xs">
                        <div><span className="text-slate-500">Quality: </span><span className="font-black text-slate-900">{campaign.quality_score || 50}</span><span className="text-slate-500"> / {campaign.quality_tier || "average"}</span></div>
                        <div><span className="text-slate-500">Required CPM: </span><span className="font-medium text-slate-900">{money(campaign.required_cpm)}</span></div>
                        <div className="text-slate-500">Image: {imageMetaText(campaign.image_review_metadata)}</div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {parseList(campaign.landing_review_flags).length > 0
                            ? parseList(campaign.landing_review_flags).map((flag) => (
                              <span key={flag} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                <AlertTriangle size={10} /> {flag}
                              </span>
                            ))
                            : <span className="text-slate-400">No landing flags</span>
                          }
                        </div>
                        {campaign.creative_review_notes && (
                          <div className="mt-1 rounded-lg bg-slate-50 p-1.5 text-slate-600">{campaign.creative_review_notes}</div>
                        )}
                      </div>
                    </td>

                    {/* CPM Controls */}
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Advertiser CPM</label>
                          <input
                            value={cpms[campaign.id] ?? String(campaign.admin_cpm || campaign.advertiser_cpm_bid || "")}
                            onChange={(e) => setCpms((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                            placeholder="CPM"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">CPM Mode</label>
                          <select
                            value={cpmModes[campaign.id] ?? String(campaign.cpm_mode || "live")}
                            onChange={(e) => setCpmModes((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                          >
                            <option value="live">Live CPM</option>
                            <option value="fixed">Fixed CPM</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fixed Pub CPM</label>
                          <input
                            value={fixedCpms[campaign.id] ?? String(campaign.fixed_publisher_cpm || "")}
                            onChange={(e) => setFixedCpms((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                            placeholder="Fixed CPM"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Review Note</label>
                          <input
                            value={moderationNotes[campaign.id] || ""}
                            onChange={(e) => setModerationNotes((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                            placeholder="Note"
                          />
                        </div>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4">
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => runAction(campaign.id, "approve")}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100"
                            title="Approve"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => runAction(campaign.id, "reject")}
                            className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100"
                            title="Reject"
                          >
                            <X size={14} />
                          </button>
                          <button
                            onClick={() => runAction(campaign.id, campaign.status === "paused" ? "resume" : "pause")}
                            className={`rounded-lg border p-2 transition-colors ${campaign.status === "paused" ? "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100" : "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100"}`}
                            title={campaign.status === "paused" ? "Resume" : "Pause"}
                          >
                            {campaign.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
                          </button>
                          <button
                            onClick={() => openEdit(campaign)}
                            className="rounded-lg border border-purple-200 bg-purple-50 p-2 text-purple-600 transition-colors hover:bg-purple-100"
                            title="Edit Campaign"
                          >
                            <Edit3 size={14} />
                          </button>
                        </div>
                        <button
                          onClick={() => runAction(campaign.id, "update_cpm")}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          Save CPM
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr><td colSpan={10} className="p-10 text-center text-slate-500">No internal rewarded campaigns.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Campaign Modal */}
      {editingCampaign && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4">
          <div className="my-8 w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Edit Campaign</h2>
                <p className="mt-0.5 text-sm text-slate-500">{editingCampaign.campaign_name}</p>
              </div>
              <button onClick={() => setEditingCampaign(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-6">
              {/* Basic Info */}
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <label className="col-span-2 block text-xs font-semibold text-slate-600">Campaign Name
                    <input value={editForm.campaign_name} onChange={(e) => ef("campaign_name", e.target.value)} className={inputCls} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Title
                    <input value={editForm.title} onChange={(e) => ef("title", e.target.value)} className={inputCls} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">CTA Text
                    <input value={editForm.cta_text} onChange={(e) => ef("cta_text", e.target.value)} className={inputCls} />
                  </label>
                  <label className="col-span-2 block text-xs font-semibold text-slate-600">Description
                    <textarea value={editForm.description} onChange={(e) => ef("description", e.target.value)} rows={3} className={inputCls} />
                  </label>
                  <label className="col-span-2 block text-xs font-semibold text-slate-600">Image URL
                    <input value={editForm.image_url} onChange={(e) => ef("image_url", e.target.value)} className={inputCls} placeholder="https://..." />
                  </label>
                  <label className="col-span-2 block text-xs font-semibold text-slate-600">Landing URL
                    <input value={editForm.landing_url} onChange={(e) => ef("landing_url", e.target.value)} className={inputCls} placeholder="https://..." />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Title Color
                    <div className="mt-1 flex gap-2">
                      <input type="color" value={editForm.title_color || "#000000"} onChange={(e) => ef("title_color", e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 p-0.5" />
                      <input value={editForm.title_color} onChange={(e) => ef("title_color", e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="#000000" />
                    </div>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Body Color
                    <div className="mt-1 flex gap-2">
                      <input type="color" value={editForm.body_color || "#000000"} onChange={(e) => ef("body_color", e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 p-0.5" />
                      <input value={editForm.body_color} onChange={(e) => ef("body_color", e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="#000000" />
                    </div>
                  </label>
                </div>
              </div>

              {/* Categories */}
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Categories</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {MINIAPP_CREATIVE_CATEGORIES.map((cat) => (
                    <label key={cat} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={editCats.includes(cat)}
                        onChange={() => setEditCats((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat])}
                        className="accent-blue-600"
                      />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>

              {/* Targeting */}
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Targeting & Schedule</h3>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block text-xs font-semibold text-slate-600">Countries (comma-separated ISO codes)
                    <input value={editForm.countries} onChange={(e) => ef("countries", e.target.value)} className={inputCls} placeholder="US, GB, NG …" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Languages (comma-separated)
                    <input value={editForm.languages} onChange={(e) => ef("languages", e.target.value)} className={inputCls} placeholder="en, fr …" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">VPN Policy
                    <select value={editForm.vpn_policy} onChange={(e) => ef("vpn_policy", e.target.value)} className={inputCls}>
                      <option value="allow_all">Allow all traffic</option>
                      <option value="prefer_non_vpn">Prefer non-VPN</option>
                      <option value="exclude_vpn">Exclude VPN/proxy</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Device Policy
                    <select value={editForm.device_policy} onChange={(e) => ef("device_policy", e.target.value)} className={inputCls}>
                      <option value="all">All</option>
                      <option value="mobile">Mobile only</option>
                      <option value="desktop">Desktop only</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">OS Policy
                    <select value={editForm.os_policy} onChange={(e) => ef("os_policy", e.target.value)} className={inputCls}>
                      <option value="all">All</option>
                      <option value="android">Android</option>
                      <option value="ios">iOS</option>
                      <option value="desktop_web">Desktop/Web</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Start Date
                    <input type="date" value={editForm.start_at} onChange={(e) => ef("start_at", e.target.value)} className={inputCls} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">End Date
                    <input type="date" value={editForm.end_at} onChange={(e) => ef("end_at", e.target.value)} className={inputCls} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Daily Budget Limit ($)
                    <input type="number" min="0" step="0.01" value={editForm.daily_budget_limit} onChange={(e) => ef("daily_budget_limit", e.target.value)} className={inputCls} placeholder="No limit" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">Frequency Cap (per user)
                    <input type="number" min="0" step="1" value={editForm.frequency_cap_per_user} onChange={(e) => ef("frequency_cap_per_user", e.target.value)} className={inputCls} placeholder="No cap" />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setEditingCampaign(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleEditSubmit} disabled={editLoading} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {editLoading && <Loader2 className="animate-spin" size={16} />}
                {editLoading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
