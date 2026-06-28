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
  return `${startText} - ${endText}`;
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

  return (
    <AdminLayout>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Mini App Rewarded Campaigns</h2>
          {message && <span className="text-xs font-semibold text-slate-500">{message}</span>}
        </div>
        <div className="border-b border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Category CPM Adjustments</div>
          <div className="grid gap-2 md:grid-cols-4">
            {MINIAPP_CREATIVE_CATEGORIES.map((category) => (
              <label key={category} className="rounded border border-slate-200 bg-white p-2 text-xs font-semibold text-slate-600">
                <span>{category}</span>
                <input
                  defaultValue={Number(categoryAdjustments[category] || 0).toFixed(2)}
                  onBlur={(event) => updateCategoryAdjustment(category, event.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1 font-mono text-xs"
                />
              </label>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Creative</th><th className="px-3 py-2">Advertiser</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Budget</th><th className="px-3 py-2">Impressions</th><th className="px-3 py-2">Revenue</th><th className="px-3 py-2">Targeting</th><th className="px-3 py-2">Review</th><th className="px-3 py-2">CPM Controls</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="px-3 py-2">
                      <div className="flex gap-3">
                        {campaign.image_url ? <img src={campaign.image_url} alt={campaign.title} className="h-20 w-20 rounded border border-slate-200 object-cover" /> : <div className="h-20 w-20 rounded border border-slate-200 bg-slate-50" />}
                        <div className="min-w-0 max-w-[260px]">
                          <div className="font-semibold text-slate-900">{campaign.campaign_name}</div>
                          <div className="text-xs font-bold" style={{ color: campaign.title_color || undefined }}>{campaign.title}</div>
                          <div className="line-clamp-2 text-xs text-slate-500" style={{ color: campaign.body_color || undefined }}>{campaign.description}</div>
                          <a href={campaign.landing_url || "#"} target="_blank" rel="noreferrer" className="block truncate text-xs font-semibold text-blue-700">{campaign.landing_url}</a>
                          <div className="text-xs text-slate-500">CTA: <span className="font-bold text-slate-800">{campaign.cta_text || "Learn More"}</span></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{campaign.username ? `@${campaign.username}` : campaign.first_name || `User #${campaign.advertiser_id}`}</div>
                      <div className="text-xs text-slate-500 capitalize">Trust: {campaign.advertiser_trust_level || "new"}</div>
                      <div className="text-xs text-slate-500">Spend {money(campaign.advertiser_total_spend)} / Approved {campaign.advertiser_approved_campaigns || 0} / Rejected {campaign.advertiser_rejected_campaigns || 0}</div>
                    </td>
                    <td className="px-3 py-2 capitalize"><div>{campaign.status}</div><div className="text-xs text-slate-500">Review: {campaign.creative_review_status || "pending"}</div></td>
                    <td className="px-3 py-2"><div>{campaign.campaign_budget_mode === "unlimited" ? "Unlimited" : money(campaign.budget)}</div><div className="text-xs text-slate-500">Left {campaign.campaign_budget_mode === "unlimited" ? "Balance funded" : money(campaign.remaining_budget)}</div><div className="text-xs text-slate-500">Bid {money(campaign.advertiser_cpm_bid)}</div></td>
                    <td className="px-3 py-2">{numberValue(campaign.impressions)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div>Advertiser: {money(campaign.spend)}</div>
                      <div>Publisher: {money(campaign.publisher_revenue)}</div>
                      <div>AdsGalaxy: {money(campaign.ads_galaxy_revenue)}</div>
                      <div>Reserve: {money(campaign.reserve_revenue)}</div>
                      <div>Avg Q: {Number(campaign.avg_quality_factor || 0).toFixed(4)}</div>
                      <div>Campaign Quality: {campaign.quality_score || 50} / {campaign.quality_tier || "average"}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>Countries: {listValue(campaign.countries || campaign.target_countries)}</div>
                      <div>Categories: {listValue(campaign.categories)}</div>
                      <div>Languages: {listValue(campaign.languages)}</div>
                      <div>{policyValue(campaign.vpn_policy)} / {policyValue(campaign.device_policy)} / {policyValue(campaign.os_policy)}</div>
                      <div>{scheduleValue(campaign.start_at, campaign.end_at)}</div>
                      <div>Daily: {campaign.daily_budget_limit ? money(campaign.daily_budget_limit) : "No cap"} / Freq: {campaign.frequency_cap_per_user || "No cap"}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>Quality: <span className="font-black">{campaign.quality_score || 50}</span> / {campaign.quality_tier || "average"}</div>
                      <div>Required CPM: {money(campaign.required_cpm)}</div>
                      <div>Image: {imageMetaText(campaign.image_review_metadata)}</div>
                      <div className="mt-1 space-y-1">
                        {parseList(campaign.landing_review_flags).length > 0 ? parseList(campaign.landing_review_flags).map((flag) => (
                          <div key={flag} className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700"><AlertTriangle size={11} /> {flag}</div>
                        )) : <span className="text-slate-500">No landing flags</span>}
                      </div>
                      {campaign.creative_review_notes && <div className="mt-1 rounded bg-slate-50 p-1 text-slate-600">{campaign.creative_review_notes}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <input value={cpms[campaign.id] ?? String(campaign.admin_cpm || campaign.advertiser_cpm_bid || "")} onChange={(event) => setCpms((prev) => ({ ...prev, [campaign.id]: event.target.value }))} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" placeholder="Advertiser CPM" />
                        <select value={cpmModes[campaign.id] ?? String(campaign.cpm_mode || "live")} onChange={(event) => setCpmModes((prev) => ({ ...prev, [campaign.id]: event.target.value }))} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs">
                          <option value="live">Live CPM</option>
                          <option value="fixed">Fixed CPM</option>
                        </select>
                        <input value={fixedCpms[campaign.id] ?? String(campaign.fixed_publisher_cpm || "")} onChange={(event) => setFixedCpms((prev) => ({ ...prev, [campaign.id]: event.target.value }))} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" placeholder="Fixed pub CPM" />
                        <input value={moderationNotes[campaign.id] || ""} onChange={(event) => setModerationNotes((prev) => ({ ...prev, [campaign.id]: event.target.value }))} className="w-28 rounded border border-slate-200 px-2 py-1 text-xs" placeholder="Review note" />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => runAction(campaign.id, "approve")} className="rounded border border-emerald-200 p-1.5 text-emerald-600" title="Approve"><Check size={14} /></button>
                        <button onClick={() => runAction(campaign.id, "reject")} className="rounded border border-red-200 p-1.5 text-red-600" title="Reject"><X size={14} /></button>
                        <button
                          onClick={() => runAction(campaign.id, campaign.status === "paused" ? "resume" : "pause")}
                          className={`rounded border p-1.5 ${campaign.status === "paused" ? "border-blue-200 text-blue-600" : "border-amber-200 text-amber-600"}`}
                          title={campaign.status === "paused" ? "Resume" : "Pause"}
                        >
                          {campaign.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
                        </button>
                        <button onClick={() => openEdit(campaign)} className="rounded border border-purple-200 p-1.5 text-purple-600" title="Edit Campaign"><Edit3 size={14} /></button>
                        <button onClick={() => runAction(campaign.id, "update_cpm")} className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">CPM</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-slate-500">No internal rewarded campaigns.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editingCampaign && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-sm font-black text-slate-900">Edit Campaign — {editingCampaign.campaign_name}</h2>
              <button onClick={() => setEditingCampaign(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-4">
                <label className="col-span-2 block text-xs font-bold text-slate-500">Campaign Name
                  <input value={editForm.campaign_name} onChange={(e) => ef("campaign_name", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="block text-xs font-bold text-slate-500">Title
                  <input value={editForm.title} onChange={(e) => ef("title", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="block text-xs font-bold text-slate-500">CTA Text
                  <input value={editForm.cta_text} onChange={(e) => ef("cta_text", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="col-span-2 block text-xs font-bold text-slate-500">Description
                  <textarea value={editForm.description} onChange={(e) => ef("description", e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="col-span-2 block text-xs font-bold text-slate-500">Image URL
                  <input value={editForm.image_url} onChange={(e) => ef("image_url", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="https://..." />
                </label>
                <label className="col-span-2 block text-xs font-bold text-slate-500">Landing URL
                  <input value={editForm.landing_url} onChange={(e) => ef("landing_url", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="https://..." />
                </label>
                <label className="block text-xs font-bold text-slate-500">Title Color
                  <div className="mt-1 flex gap-2">
                    <input type="color" value={editForm.title_color || "#000000"} onChange={(e) => ef("title_color", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-200 p-0.5" />
                    <input value={editForm.title_color} onChange={(e) => ef("title_color", e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="#000000" />
                  </div>
                </label>
                <label className="block text-xs font-bold text-slate-500">Body Color
                  <div className="mt-1 flex gap-2">
                    <input type="color" value={editForm.body_color || "#000000"} onChange={(e) => ef("body_color", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-200 p-0.5" />
                    <input value={editForm.body_color} onChange={(e) => ef("body_color", e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="#000000" />
                  </div>
                </label>
              </div>
              <div>
                <div className="mb-2 text-xs font-bold text-slate-500">Categories</div>
                <div className="grid grid-cols-4 gap-2">
                  {MINIAPP_CREATIVE_CATEGORIES.map((cat) => (
                    <label key={cat} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
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
              <div className="grid grid-cols-2 gap-4">
                <label className="block text-xs font-bold text-slate-500">Countries (comma-separated ISO codes)
                  <input value={editForm.countries} onChange={(e) => ef("countries", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="US, GB, NG …" />
                </label>
                <label className="block text-xs font-bold text-slate-500">Languages (comma-separated)
                  <input value={editForm.languages} onChange={(e) => ef("languages", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="en, fr …" />
                </label>
                <label className="block text-xs font-bold text-slate-500">VPN Policy
                  <select value={editForm.vpn_policy} onChange={(e) => ef("vpn_policy", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="allow_all">Allow all traffic</option>
                    <option value="prefer_non_vpn">Prefer non-VPN</option>
                    <option value="exclude_vpn">Exclude VPN/proxy</option>
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-500">Device Policy
                  <select value={editForm.device_policy} onChange={(e) => ef("device_policy", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="all">All</option>
                    <option value="mobile">Mobile only</option>
                    <option value="desktop">Desktop only</option>
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-500">OS Policy
                  <select value={editForm.os_policy} onChange={(e) => ef("os_policy", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="all">All</option>
                    <option value="android">Android</option>
                    <option value="ios">iOS</option>
                    <option value="desktop_web">Desktop/Web</option>
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-500">Start Date
                  <input type="date" value={editForm.start_at} onChange={(e) => ef("start_at", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="block text-xs font-bold text-slate-500">End Date
                  <input type="date" value={editForm.end_at} onChange={(e) => ef("end_at", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
                </label>
                <label className="block text-xs font-bold text-slate-500">Daily Budget Limit ($)
                  <input type="number" min="0" step="0.01" value={editForm.daily_budget_limit} onChange={(e) => ef("daily_budget_limit", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="No limit" />
                </label>
                <label className="block text-xs font-bold text-slate-500">Frequency Cap (per user)
                  <input type="number" min="0" step="1" value={editForm.frequency_cap_per_user} onChange={(e) => ef("frequency_cap_per_user", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" placeholder="No cap" />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setEditingCampaign(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleEditSubmit} disabled={editLoading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {editLoading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
