"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { Loader2, Plus, Smartphone } from "lucide-react";

type Campaign = {
  id: number;
  campaign_name: string;
  title: string;
  image_url: string;
  landing_url: string;
  budget: string | number;
  remaining_budget: string | number;
  admin_cpm: string | number;
  status: string;
  impressions: string | number;
  spend: string | number;
};

const emptyForm = {
  campaign_name: "",
  title: "",
  description: "",
  image_url: "",
  landing_url: "",
  budget: "",
  target_countries: "",
};

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

export default function AdvertiserMiniAppRewardedPage() {
  const { setTitle } = useHeader();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
  }, [setTitle]);

  const submit = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await apiFetch("/api/advertiser/miniapp-rewarded-campaigns", {
        method: "POST",
        body: JSON.stringify(form),
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
              ["budget", "Budget"],
              ["target_countries", "Target Countries, optional"],
            ].map(([key, label]) => (
              <input key={key} value={(form as any)[key]} onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            ))}
            <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Rewarded Ad Description" className="min-h-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 sm:col-span-2" />
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Impressions</th><th className="px-3 py-2">Spend</th><th className="px-3 py-2">CPM</th><th className="px-3 py-2">Remaining</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}><td className="px-3 py-2 font-semibold">{campaign.campaign_name}</td><td className="px-3 py-2 capitalize">{campaign.status}</td><td className="px-3 py-2">{numberValue(campaign.impressions)}</td><td className="px-3 py-2">{money(campaign.spend)}</td><td className="px-3 py-2">{money(campaign.admin_cpm)}</td><td className="px-3 py-2">{money(campaign.remaining_budget)}</td></tr>
                  ))}
                  {campaigns.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No Mini App rewarded campaigns yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
