"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, @next/next/no-img-element -- legacy admin campaign page */

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Edit3, Loader2, Pause, Play, RefreshCw, X } from "lucide-react";
import { useAdminRequestGuard } from "@/hooks/useAdminRequestGuard";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import ModerationRejectFields from "@/components/admin/ModerationRejectFields";
import { getApiErrorMessage } from "@/lib/apiErrorMessage";

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
  requires_re_moderation?: boolean | number;
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
  fixed_cpm_override_reason?: string | null;
  fixed_cpm_override_expires_at?: string | null;
  campaign_budget_mode?: string | null;
  daily_budget_mode?: string | null;
  impressions: string | number;
  clicks?: string | number;
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
  const beginListRequest = useAdminRequestGuard();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [cpms, setCpms] = useState<Record<number, string>>({});
  const [cpmModes, setCpmModes] = useState<Record<number, string>>({});
  const [fixedCpms, setFixedCpms] = useState<Record<number, string>>({});
  const [fixedCpmReasons, setFixedCpmReasons] = useState<Record<number, string>>({});
  const [fixedCpmExpiries, setFixedCpmExpiries] = useState<Record<number, string>>({});
  const [moderationNotes, setModerationNotes] = useState<Record<number, string>>({});
  const [policyRuleKeys, setPolicyRuleKeys] = useState<Record<number, string>>({});
  const [pendingRejectionId, setPendingRejectionId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editCats, setEditCats] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [syncCampaign, setSyncCampaign] = useState<Campaign | null>(null);
  const [syncState, setSyncState] = useState<any>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncForm, setSyncForm] = useState({ target_impressions: "", target_clicks: "", duration_minutes: "60" });

  const fetchCampaigns = async () => {
    const controller = beginListRequest();
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/miniapp-rewarded-campaigns?page=${page}&limit=20`, { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load campaigns");
      setCampaigns(data.campaigns || []);
      setTotalPages(data.totalPages || 1);
    } catch (error: any) {
      if (controller.signal.aborted) return;
      setMessage(error.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, [page, beginListRequest]);

  const runAction = async (id: number, action: string) => {
    setMessage("");
    try {
      const campaign = campaigns.find((item) => item.id === id);
      if (action === "reject" && !policyRuleKeys[id]) throw new Error("MODERATION_REASON_REQUIRED");
      const res = await fetch(action === "reject" ? "/api/admin/moderation-rejections" : "/api/admin/miniapp-rewarded-campaigns", {
        method: action === "reject" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? {
          entity_type: "miniapp_rewarded_campaign", entity_id: id,
          policy_rule_key: policyRuleKeys[id], internal_note: moderationNotes[id] || "",
        } : {
          id,
          action,
          admin_cpm: cpms[id] ?? campaign?.admin_cpm ?? campaign?.advertiser_cpm_bid,
          cpm_mode: cpmModes[id] ?? campaign?.cpm_mode ?? "live",
          fixed_publisher_cpm: fixedCpms[id] ?? campaign?.fixed_publisher_cpm ?? "",
          fixed_cpm_override_reason: fixedCpmReasons[id] ?? campaign?.fixed_cpm_override_reason ?? "",
          fixed_cpm_override_expires_at: fixedCpmExpiries[id] ?? campaign?.fixed_cpm_override_expires_at ?? "",
          moderation_notes: moderationNotes[id] || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Campaign action failed"));
      setMessage("Campaign updated.");
      await fetchCampaigns();
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

  const loadSync = async (campaign: Campaign, quiet = false) => {
    if (!quiet) setSyncLoading(true);
    try {
      const res = await fetch(`/api/admin/miniapp-rewarded-campaigns/${campaign.id}/external-delivery-sync`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to load delivery sync");
      setSyncState(data);
      setSyncForm((current) => ({
        ...current,
        target_impressions: current.target_impressions || String(data.campaign.current_impressions),
        target_clicks: current.target_clicks || String(data.campaign.current_clicks),
      }));
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      if (!quiet) setSyncLoading(false);
    }
  };

  const openSync = (campaign: Campaign) => {
    setSyncCampaign(campaign);
    setSyncState(null);
    setSyncForm({ target_impressions: "", target_clicks: "", duration_minutes: "60" });
    void loadSync(campaign);
  };

  const submitSync = async () => {
    if (!syncCampaign) return;
    setSyncLoading(true);
    try {
      const res = await fetch(`/api/admin/miniapp-rewarded-campaigns/${syncCampaign.id}/external-delivery-sync`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_impressions: Number(syncForm.target_impressions), target_clicks: Number(syncForm.target_clicks), duration_seconds: Number(syncForm.duration_minutes) * 60 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to start delivery sync");
      setSyncState(data);
      setMessage("External delivery sync started.");
    } catch (error: any) { setMessage(error.message); }
    finally { setSyncLoading(false); }
  };

  const controlSync = async (action: "pause" | "resume" | "cancel") => {
    if (!syncCampaign) return;
    setSyncLoading(true);
    try {
      const res = await fetch(`/api/admin/miniapp-rewarded-campaigns/${syncCampaign.id}/external-delivery-sync`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Unable to ${action} sync`);
      setSyncState(data);
      setMessage(`Delivery sync ${action}d.`);
    } catch (error: any) { setMessage(error.message); }
    finally { setSyncLoading(false); }
  };

  useEffect(() => {
    if (!syncCampaign || !["running", "paused"].includes(syncState?.sync?.status)) return;
    const timer = window.setInterval(() => void loadSync(syncCampaign, true), 5000);
    return () => window.clearInterval(timer);
  }, [syncCampaign, syncState?.sync?.status]);

  const ef = (field: string, value: string) => setEditForm((prev) => ({ ...prev, [field]: value }));

  const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300";

  return (
    <AdminLayout>
      <ConfirmationModal isOpen={pendingRejectionId !== null} onClose={() => setPendingRejectionId(null)} onConfirm={() => { const id = pendingRejectionId; setPendingRejectionId(null); if (id !== null) void runAction(id, "reject"); }} title="Reject Mini App campaign" message="Select the policy reason for this rejection." confirmBtnText="Reject" confirmBtnVariant="danger">
        {pendingRejectionId !== null && <ModerationRejectFields scopes={["advertiser.general", "advertiser.mini-app"]} ruleKey={policyRuleKeys[pendingRejectionId] || ""} internalNote={moderationNotes[pendingRejectionId] || ""} onRuleKey={(value) => setPolicyRuleKeys((prev) => ({ ...prev, [pendingRejectionId]: value }))} onInternalNote={(value) => setModerationNotes((prev) => ({ ...prev, [pendingRejectionId]: value }))} />}
      </ConfirmationModal>
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
                          <div className="mt-1.5 text-xs text-slate-500">Review: {campaign.requires_re_moderation ? "Re-Moderation" : (campaign.creative_review_status || "pending")}</div>
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
                          <textarea
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
                          <textarea
                            value={fixedCpms[campaign.id] ?? String(campaign.fixed_publisher_cpm || "")}
                            onChange={(e) => setFixedCpms((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                            placeholder="Fixed CPM"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fixed Override Reason</label>
                          <textarea
                            value={fixedCpmReasons[campaign.id] ?? String(campaign.fixed_cpm_override_reason || "")}
                            onChange={(e) => setFixedCpmReasons((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                            placeholder="Required for fixed"
                            rows={2}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Override Expiry</label>
                          <input
                            type="datetime-local"
                            value={fixedCpmExpiries[campaign.id] ?? (campaign.fixed_cpm_override_expires_at ? new Date(campaign.fixed_cpm_override_expires_at).toISOString().slice(0, 16) : "")}
                            onChange={(e) => setFixedCpmExpiries((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                            className="w-40 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
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
                            onClick={() => setPendingRejectionId(campaign.id)}
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
                          <button onClick={() => openSync(campaign)} className="rounded-lg border border-cyan-200 bg-cyan-50 p-2 text-cyan-700 hover:bg-cyan-100" title="Update delivery totals">
                            <RefreshCw size={14} />
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
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded p-1 hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={16} /></button>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded p-1 hover:bg-slate-100 disabled:opacity-40" aria-label="Next page"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {syncCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-3 sm:p-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div><h2 className="font-bold text-slate-900">Update delivery totals</h2><p className="text-sm text-slate-500">{syncCampaign.campaign_name}</p></div>
              <button onClick={() => setSyncCampaign(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="space-y-5 p-5">
              {syncLoading && !syncState ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : syncState && <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[['Impressions', syncState.campaign.current_impressions], ['Clicks', syncState.campaign.current_clicks], ['Platform', syncState.campaign.platform_impressions], ['External', syncState.campaign.external_impressions]].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-bold text-slate-900">{numberValue(value)}</div></div>
                  ))}
                </div>
                {syncState.sync && (
                  <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold capitalize text-cyan-900">{String(syncState.sync.status).replaceAll('_', ' ')}</span><span className="text-sm text-cyan-800">{syncState.sync.progress_percent}% · {numberValue(syncState.sync.time_remaining_seconds)}s remaining</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-cyan-100"><div className="h-full bg-cyan-600" style={{ width: `${Math.min(100, syncState.sync.progress_percent)}%` }} /></div>
                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div>Target impressions: <b>{numberValue(syncState.sync.target_impressions)}</b></div><div>Target clicks: <b>{numberValue(syncState.sync.target_clicks)}</b></div>
                      <div>External added: <b>{numberValue(syncState.sync.external_impressions_added)}</b></div><div>Platform during sync: <b>{numberValue(syncState.sync.platform_impressions_during)}</b></div>
                      <div>External spend: <b>{money(syncState.sync.external_spend)}</b></div><div>Budget remaining: <b>{money(syncState.campaign.remaining_budget)}</b></div>
                    </div>
                    {["running", "paused"].includes(syncState.sync.status) && <div className="flex gap-2">
                      <button disabled={syncLoading} onClick={() => controlSync(syncState.sync.status === "paused" ? "resume" : "pause")} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{syncState.sync.status === "paused" ? "Resume" : "Pause"}</button>
                      <button disabled={syncLoading} onClick={() => controlSync("cancel")} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Cancel</button>
                    </div>}
                  </div>
                )}
                {!syncState.sync || !["running", "paused"].includes(syncState.sync.status) ? <div className="space-y-4">
                  <p className="text-sm text-slate-600">Set final cumulative totals. Platform traffic continues to count and automatically reduces the external amount added.</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="text-xs font-semibold text-slate-600">Final impressions<input type="number" min={syncState.campaign.current_impressions} value={syncForm.target_impressions} onChange={(e) => setSyncForm({ ...syncForm, target_impressions: e.target.value })} className={inputCls} /></label>
                    <label className="text-xs font-semibold text-slate-600">Final clicks<input type="number" min={syncState.campaign.current_clicks} value={syncForm.target_clicks} onChange={(e) => setSyncForm({ ...syncForm, target_clicks: e.target.value })} className={inputCls} /></label>
                    <label className="text-xs font-semibold text-slate-600">Duration (minutes)<input type="number" min="1" max="43200" value={syncForm.duration_minutes} onChange={(e) => setSyncForm({ ...syncForm, duration_minutes: e.target.value })} className={inputCls} /></label>
                  </div>
                  <button disabled={syncLoading} onClick={submitSync} className="flex items-center gap-2 rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{syncLoading && <Loader2 size={15} className="animate-spin" />} Start update</button>
                </div> : null}
                {syncState.history?.length > 0 && <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Sync history</h3>
                  <div className="space-y-2">
                    {syncState.history.map((item: any) => <div key={item.id} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 text-xs sm:grid-cols-4">
                      <span className="font-semibold capitalize">{String(item.status).replaceAll('_', ' ')}</span>
                      <span>{numberValue(item.external_impressions_added)} external impressions</span>
                      <span>{numberValue(item.external_clicks_added)} external clicks</span>
                      <span>{money(item.external_spend)} spent</span>
                    </div>)}
                  </div>
                </div>}
              </>}
            </div>
          </div>
        </div>
      )}

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
