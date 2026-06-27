"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { Check, ChevronDown, Loader2, Plus, Smartphone, Store } from "lucide-react";

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
  image_url: string;
  landing_url: string;
  cta_text?: string;
  title_color?: string | null;
  body_color?: string | null;
  postback_url?: string | null;
  budget: string | number;
  remaining_budget: string | number;
  advertiser_cpm_bid?: string | number;
  campaign_budget_mode?: string | null;
  daily_budget_mode?: string | null;
  target_countries?: string | null;
  status: string;
  impressions: string | number;
  clicks?: string | number;
  conversions?: string | number;
  conversion_value?: string | number;
  today_impressions: string | number;
  yesterday_impressions: string | number;
  spend: string | number;
  today_spend: string | number;
  last_displayed_at?: string | null;
  countries?: string | string[] | null;
  languages?: string | string[] | null;
  vpn_policy?: string | null;
  device_policy?: string | null;
  os_policy?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  daily_budget_limit?: string | number | null;
  frequency_cap_per_user?: string | number | null;
  traffic_quality_rating?: string;
  inventory_quality_rating?: string;
  categories?: string[] | string | null;
};

type MarketplaceItem = {
  id: number;
  name: string;
  username: string;
  category: string;
  country: string;
  language: string;
  traffic_quality_rating: string;
  monthly_impressions: number;
};

const emptyForm = {
  campaign_name: "",
  title: "",
  description: "",
  image_url: "",
  landing_url: "",
  cta_text: "Learn More",
  title_color: "",
  body_color: "",
  postback_url: "",
  categories: [] as string[],
  budget: "",
  advertiser_cpm_bid: "",
  campaign_budget_mode: "custom",
  daily_budget_mode: "custom",
  countries: "",
  languages: "",
  vpn_policy: "allow_all",
  device_policy: "all",
  os_policy: "all",
  start_at: "",
  end_at: "",
  daily_budget_limit: "",
  frequency_cap_per_user: "",
  direct_placement_mode: "network",
  direct_inventory_scope: "network",
  direct_categories: "",
  direct_countries: "",
  direct_languages: "",
};

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not displayed";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function parseList(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (!value) return "All";
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.join(", ");
  } catch {
    // Plain strings are displayed as-is.
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

export default function AdvertiserMiniAppRewardedPage() {
  const { setTitle } = useHeader();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [targetingOpen, setTargetingOpen] = useState(false);
  const [recommendedCpm, setRecommendedCpm] = useState("1.00");
  const [recommendedInventory, setRecommendedInventory] = useState<MarketplaceItem[]>([]);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<number[]>([]);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/advertiser/miniapp-rewarded-campaigns");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load campaigns");
      setCampaigns(data || []);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTitle("Mini App Rewarded Ads");
    fetchCampaigns();
    apiFetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data?.miniapp_internal_recommended_cpm) setRecommendedCpm(String(data.miniapp_internal_recommended_cpm));
      })
      .catch(() => {
        // Recommended CPM is advisory; backend still validates.
      });
  }, [setTitle]);

  useEffect(() => {
    const query = new URLSearchParams({
      type: "miniapp",
      category: Array.isArray(form.categories) ? form.categories[0] || "" : "",
      countries: form.countries,
      languages: form.languages,
      budget: form.budget,
    });
    apiFetch(`/api/advertiser/marketplace/recommended?${query.toString()}`)
      .then((res) => res.json())
      .then((data) => setRecommendedInventory(data.inventory || []))
      .catch(() => setRecommendedInventory([]));
  }, [form.categories, form.countries, form.languages, form.budget]);

  const submit = async () => {
    setSaving(true);
    setMessage("");
    try {
      if (form.start_at && form.end_at && new Date(form.start_at).getTime() >= new Date(form.end_at).getTime()) {
        throw new Error("Start date must be before end date.");
      }
      if (!form.advertiser_cpm_bid || Number(form.advertiser_cpm_bid) <= 0) {
        throw new Error("CPM Bid is required.");
      }
      if (form.campaign_budget_mode === "custom" && (!form.budget || Number(form.budget) <= 0)) {
        throw new Error("Budget is required for custom budget campaigns.");
      }
      if (form.campaign_budget_mode === "custom" && form.daily_budget_limit && Number(form.daily_budget_limit) > Number(form.budget || 0)) {
        throw new Error("Daily budget cannot exceed total campaign budget.");
      }
      if (form.frequency_cap_per_user && (!Number.isInteger(Number(form.frequency_cap_per_user)) || Number(form.frequency_cap_per_user) <= 0)) {
        throw new Error("Frequency cap must be a positive whole number.");
      }
      if (!form.cta_text.trim()) {
        throw new Error("CTA text is required.");
      }
      if (form.direct_placement_mode === "direct" && form.direct_inventory_scope === "inventory" && selectedInventoryIds.length === 0) {
        throw new Error("Select at least one Mini App or choose a category, country, or language group.");
      }

      const res = await apiFetch("/api/advertiser/miniapp-rewarded-campaigns", {
        method: "POST",
        body: JSON.stringify({ ...form, direct_inventory_type: "miniapp", direct_inventory_ids: selectedInventoryIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create campaign");
      setForm(emptyForm);
      setMessage("Campaign submitted for admin approval.");
      await fetchCampaigns();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = (category: string) => {
    setForm((prev) => {
      const selected = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: selected.includes(category)
          ? selected.filter((item) => item !== category)
          : [...selected, category],
      };
    });
  };

  const toggleInventory = (id: number) => {
    setSelectedInventoryIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
    setForm((prev) => ({ ...prev, direct_placement_mode: "direct", direct_inventory_scope: "inventory" }));
  };

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><Smartphone size={16} /> Mini App Rewarded Campaign</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["campaign_name", "Campaign Name"],
              ["title", "Rewarded Ad Title"],
              ["image_url", "Thumbnail/Image URL"],
              ["landing_url", "Landing URL"],
              ["postback_url", "Postback URL, optional, include {click_id}"],
              ["cta_text", "CTA Text, e.g. Learn More"],
              ["advertiser_cpm_bid", `CPM Bid, recommended $${Number(recommendedCpm || 0).toFixed(2)}`],
            ].map(([key, label]) => (
              <input key={key} value={(form as any)[key]} onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            ))}
            <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Rewarded Ad Description" className="min-h-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 sm:col-span-2" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-600">Title Color</span>
              <input type="color" value={form.title_color || "#4f46e5"} onChange={(event) => setForm((prev) => ({ ...prev, title_color: event.target.value }))} className="h-8 w-12 rounded border border-slate-200 bg-white" />
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, title_color: "" }))} className="ml-auto text-xs font-bold text-slate-400">Default</button>
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-600">Body Color</span>
              <input type="color" value={form.body_color || "#a7adbc"} onChange={(event) => setForm((prev) => ({ ...prev, body_color: event.target.value }))} className="h-8 w-12 rounded border border-slate-200 bg-white" />
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, body_color: "" }))} className="ml-auto text-xs font-bold text-slate-400">Default</button>
            </label>
          </div>
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-relaxed text-blue-800">
            Static image: Image must be square (1:1). Maximum file size: 1 MB. Supported dimensions: 240px-1024px.
            <br />
            GIF: GIF must be square (1:1). Maximum file size: 2 MB. Supported dimensions: 240px-600px.
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Categories</div>
            <p className="mt-1 text-xs font-semibold text-slate-500">Default: All Categories — your ad can display across all eligible categories.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {MINIAPP_CREATIVE_CATEGORIES.map((category) => {
                const active = Array.isArray(form.categories) && form.categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <select value={form.campaign_budget_mode} onChange={(event) => setForm((prev) => ({ ...prev, campaign_budget_mode: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
              <option value="custom">Custom campaign budget</option>
              <option value="unlimited">Unlimited campaign budget</option>
            </select>
            <input value={form.budget} disabled={form.campaign_budget_mode === "unlimited"} onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))} placeholder={form.campaign_budget_mode === "unlimited" ? "Runs until balance is exhausted" : "Budget"} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100" />
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setTargetingOpen((prev) => !prev)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
              <span>
                <span className="block text-xs font-black uppercase tracking-widest text-slate-400">Targeting</span>
                <span className="block text-sm font-bold text-slate-900">All Mini App users by default</span>
              </span>
              <ChevronDown size={18} className={`text-slate-400 transition-transform ${targetingOpen ? "rotate-180" : ""}`} />
            </button>
            {targetingOpen && (
              <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
                <input value={form.countries} onChange={(event) => setForm((prev) => ({ ...prev, countries: event.target.value }))} placeholder="Countries, optional (US, NG, GB)" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                <input value={form.languages} onChange={(event) => setForm((prev) => ({ ...prev, languages: event.target.value }))} placeholder="Languages, optional (en, fr)" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                <select value={form.vpn_policy} onChange={(event) => setForm((prev) => ({ ...prev, vpn_policy: event.target.value }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="allow_all">Allow all traffic</option>
                  <option value="prefer_non_vpn">Prefer non-VPN traffic</option>
                  <option value="exclude_vpn">Exclude VPN/proxy traffic</option>
                </select>
                <select value={form.device_policy} onChange={(event) => setForm((prev) => ({ ...prev, device_policy: event.target.value }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="all">All devices</option>
                  <option value="mobile">Mobile only</option>
                  <option value="desktop">Desktop only</option>
                </select>
                <select value={form.os_policy} onChange={(event) => setForm((prev) => ({ ...prev, os_policy: event.target.value }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="all">All platforms</option>
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                  <option value="desktop_web">Desktop/Web</option>
                </select>
                <input type="number" min="1" step="1" value={form.frequency_cap_per_user} onChange={(event) => setForm((prev) => ({ ...prev, frequency_cap_per_user: event.target.value }))} placeholder="Max impressions per user per day" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                <input type="datetime-local" value={form.start_at} onChange={(event) => setForm((prev) => ({ ...prev, start_at: event.target.value }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                <input type="datetime-local" value={form.end_at} onChange={(event) => setForm((prev) => ({ ...prev, end_at: event.target.value }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                <select value={form.daily_budget_mode} onChange={(event) => setForm((prev) => ({ ...prev, daily_budget_mode: event.target.value, daily_budget_limit: event.target.value === "unlimited" ? "" : prev.daily_budget_limit }))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="custom">Custom daily budget</option>
                  <option value="unlimited">Unlimited daily budget</option>
                </select>
                <input type="number" min="0" step="0.01" disabled={form.daily_budget_mode === "unlimited"} value={form.daily_budget_limit} onChange={(event) => setForm((prev) => ({ ...prev, daily_budget_limit: event.target.value }))} placeholder="Daily budget limit, optional" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100" />
              </div>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
              <Store size={16} /> Placement Buying
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({ ...prev, direct_placement_mode: "network", direct_inventory_scope: "network" }));
                  setSelectedInventoryIds([]);
                }}
                className={`rounded-lg border p-3 text-left text-sm ${form.direct_placement_mode === "network" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}
              >
                <span className="font-black text-slate-900">Run Across Network</span>
                <span className="mt-1 block text-xs font-semibold text-slate-500">Eligible Mini Apps can serve this campaign.</span>
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, direct_placement_mode: "direct", direct_inventory_scope: "inventory" }))}
                className={`rounded-lg border p-3 text-left text-sm ${form.direct_placement_mode === "direct" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}
              >
                <span className="font-black text-slate-900">Select Specific Mini Apps</span>
                <span className="mt-1 block text-xs font-semibold text-slate-500">Pick one, multiple, category, country, or language group.</span>
              </button>
            </div>

            {form.direct_placement_mode === "direct" && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <input value={form.direct_categories} onChange={(event) => setForm((prev) => ({ ...prev, direct_categories: event.target.value, direct_inventory_scope: "category" }))} placeholder="Categories" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  <input value={form.direct_countries} onChange={(event) => setForm((prev) => ({ ...prev, direct_countries: event.target.value, direct_inventory_scope: "country" }))} placeholder="Countries, US, NG" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  <input value={form.direct_languages} onChange={(event) => setForm((prev) => ({ ...prev, direct_languages: event.target.value, direct_inventory_scope: "language" }))} placeholder="Languages, en, fr" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {recommendedInventory.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-400 sm:col-span-3">No Mini App recommendations yet.</div>
                  ) : recommendedInventory.slice(0, 6).map((item) => {
                    const selected = selectedInventoryIds.includes(item.id);
                    return (
                      <button key={item.id} type="button" onClick={() => toggleInventory(item.id)} className={`rounded-lg border p-3 text-left ${selected ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-black text-slate-900">{item.name}</span>
                          {selected && <Check size={14} className="text-blue-600" />}
                        </div>
                        <p className="mt-1 text-[10px] font-bold uppercase text-slate-400">@{item.username || "private"}</p>
                        <p className="mt-2 text-[10px] font-semibold text-slate-500">{numberValue(item.monthly_impressions)} reach / {item.traffic_quality_rating}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button onClick={submit} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            Submit
          </button>
          {message && <div className="mt-3 text-xs font-semibold text-slate-500">{message}</div>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-900">Campaign Reporting</div>
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={20} /></div>
          ) : campaigns.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No Mini App rewarded campaigns yet.</div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="grid gap-3 md:hidden">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{campaign.campaign_name}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mini App Campaign</p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600">{campaign.status}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div><p className="font-black text-slate-900">{numberValue(campaign.impressions)}</p><p className="font-bold uppercase text-slate-400">Lifetime impressions</p></div>
                      <div><p className="font-black text-slate-900">{numberValue(campaign.clicks)}</p><p className="font-bold uppercase text-slate-400">Clicks</p></div>
                      <div><p className="font-black text-slate-900">{numberValue(campaign.conversions)}</p><p className="font-bold uppercase text-slate-400">Conversions</p></div>
                      <div><p className="font-black text-slate-900">{numberValue(campaign.today_impressions)}</p><p className="font-bold uppercase text-slate-400">Today impressions</p></div>
                      <div><p className="font-black text-slate-900">{numberValue(campaign.yesterday_impressions)}</p><p className="font-bold uppercase text-slate-400">Yesterday impressions</p></div>
                      <div><p className="font-black text-slate-900">{money(campaign.spend)}</p><p className="font-bold uppercase text-slate-400">Lifetime spend</p></div>
                      <div><p className="font-black text-slate-900">{money(campaign.today_spend)}</p><p className="font-bold uppercase text-slate-400">Today spend</p></div>
                      <div><p className="font-black text-slate-900">{money(campaign.remaining_budget)}</p><p className="font-bold uppercase text-slate-400">Remaining</p></div>
                      <div><p className="font-black text-slate-900">{money(campaign.advertiser_cpm_bid)}</p><p className="font-bold uppercase text-slate-400">CPM bid</p></div>
                      <div><p className="font-black text-slate-900">{campaign.traffic_quality_rating || "Good"}</p><p className="font-bold uppercase text-slate-400">Traffic quality</p></div>
                      <div><p className="font-black text-slate-900">{campaign.inventory_quality_rating || "Good"}</p><p className="font-bold uppercase text-slate-400">Inventory quality</p></div>
                    </div>
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="text-xs font-black text-slate-900">{formatDateTime(campaign.last_displayed_at)}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Last displayed</p>
                    </div>
                    <div className="mt-3 border-t border-slate-200 pt-3 text-xs">
                      <p className="font-black text-slate-900">Countries: {parseList(campaign.countries || campaign.target_countries)}</p>
                      <p className="font-bold text-slate-500">Languages: {parseList(campaign.languages)} / Device: {policyLabel(campaign.device_policy)} / OS: {policyLabel(campaign.os_policy)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1120px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Campaign</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Lifetime Impressions</th>
                      <th className="px-3 py-2">Clicks</th>
                      <th className="px-3 py-2">Conversions</th>
                      <th className="px-3 py-2">Today Impressions</th>
                      <th className="px-3 py-2">Yesterday Impressions</th>
                      <th className="px-3 py-2">Lifetime Spend</th>
                      <th className="px-3 py-2">Today Spend</th>
                      <th className="px-3 py-2">Remaining Budget</th>
                      <th className="px-3 py-2">CPM Bid</th>
                      <th className="px-3 py-2">Traffic / Inventory</th>
                      <th className="px-3 py-2">Targeting</th>
                      <th className="px-3 py-2">Last Displayed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id}>
                        <td className="px-3 py-2 font-semibold">{campaign.campaign_name}</td>
                        <td className="px-3 py-2">Mini App Campaign</td>
                        <td className="px-3 py-2 capitalize">{campaign.status}</td>
                        <td className="px-3 py-2">{numberValue(campaign.impressions)}</td>
                        <td className="px-3 py-2">{numberValue(campaign.clicks)}</td>
                        <td className="px-3 py-2">{numberValue(campaign.conversions)}</td>
                        <td className="px-3 py-2">{numberValue(campaign.today_impressions)}</td>
                        <td className="px-3 py-2">{numberValue(campaign.yesterday_impressions)}</td>
                        <td className="px-3 py-2">{money(campaign.spend)}</td>
                        <td className="px-3 py-2">{money(campaign.today_spend)}</td>
                        <td className="px-3 py-2">{money(campaign.remaining_budget)}</td>
                        <td className="px-3 py-2">{money(campaign.advertiser_cpm_bid)}</td>
                        <td className="px-3 py-2">{campaign.traffic_quality_rating || "Good"} / {campaign.inventory_quality_rating || "Good"}</td>
                        <td className="px-3 py-2 text-xs">
                          <div>Countries: {parseList(campaign.countries || campaign.target_countries)}</div>
                          <div>Languages: {parseList(campaign.languages)}</div>
                          <div>{policyLabel(campaign.vpn_policy)} / {policyLabel(campaign.device_policy)} / {policyLabel(campaign.os_policy)}</div>
                        </td>
                        <td className="px-3 py-2">{formatDateTime(campaign.last_displayed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
