"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Check, Loader2, Pause, Play, X } from "lucide-react";

type Campaign = {
  id: number;
  campaign_name: string;
  title: string;
  advertiser_id: number;
  username?: string | null;
  first_name?: string | null;
  status: string;
  budget: string | number;
  remaining_budget: string | number;
  admin_cpm: string | number;
  impressions: string | number;
  spend: string | number;
};

function money(value: unknown) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

export default function AdminMiniAppRewardedPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [cpms, setCpms] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/miniapp-rewarded-campaigns");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load campaigns");
      setCampaigns(data.campaigns || []);
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
    try {
      const res = await fetch("/api/admin/miniapp-rewarded-campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, admin_cpm: cpms[id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      setMessage("Campaign updated.");
      await fetchCampaigns();
    } catch (error: any) {
      setMessage(error.message);
    }
  };

  return (
    <AdminLayout>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Mini App Rewarded Campaigns</h2>
          {message && <span className="text-xs font-semibold text-slate-500">{message}</span>}
        </div>
        {loading ? (
          <div className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={24} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Advertiser</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Budget</th><th className="px-3 py-2">Impressions</th><th className="px-3 py-2">Spend</th><th className="px-3 py-2">Admin CPM</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="px-3 py-2"><div className="font-semibold text-slate-900">{campaign.campaign_name}</div><div className="text-xs text-slate-500">{campaign.title}</div></td>
                    <td className="px-3 py-2">{campaign.username ? `@${campaign.username}` : campaign.first_name || `User #${campaign.advertiser_id}`}</td>
                    <td className="px-3 py-2 capitalize">{campaign.status}</td>
                    <td className="px-3 py-2"><div>{money(campaign.budget)}</div><div className="text-xs text-slate-500">Left {money(campaign.remaining_budget)}</div></td>
                    <td className="px-3 py-2">{numberValue(campaign.impressions)}</td>
                    <td className="px-3 py-2">{money(campaign.spend)}</td>
                    <td className="px-3 py-2"><input value={cpms[campaign.id] ?? String(campaign.admin_cpm || "")} onChange={(event) => setCpms((prev) => ({ ...prev, [campaign.id]: event.target.value }))} className="w-24 rounded border border-slate-200 px-2 py-1 text-xs" /></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => runAction(campaign.id, "approve")} className="rounded border border-emerald-200 p-1.5 text-emerald-600" title="Approve"><Check size={14} /></button>
                        <button onClick={() => runAction(campaign.id, "reject")} className="rounded border border-red-200 p-1.5 text-red-600" title="Reject"><X size={14} /></button>
                        <button onClick={() => runAction(campaign.id, "pause")} className="rounded border border-amber-200 p-1.5 text-amber-600" title="Pause"><Pause size={14} /></button>
                        <button onClick={() => runAction(campaign.id, "resume")} className="rounded border border-blue-200 p-1.5 text-blue-600" title="Resume"><Play size={14} /></button>
                        <button onClick={() => runAction(campaign.id, "update_cpm")} className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">CPM</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No internal rewarded campaigns.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
