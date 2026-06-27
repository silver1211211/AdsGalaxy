"use client";

import React, { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, Loader2, Pause, Play, Save, Search, ShieldCheck, Star } from "lucide-react";

type InventoryRow = {
  inventory_type: "miniapp" | "channel" | "bot";
  id: number;
  name: string;
  username: string;
  status: string;
  enterprise_inventory_tier: string;
  enterprise_priority_score: number;
  enterprise_sponsorship_enabled: number | boolean;
  estimated_monthly_impressions: number;
  estimated_cpm: number;
  category: string;
  country: string;
  reservation_count: number;
};

type PackageRow = {
  id?: number;
  name: string;
  slug?: string;
  description?: string;
  miniapp_impressions: number;
  channel_posts: number;
  bot_broadcasts: number;
  featured_marketplace_days: number;
  priority_support: number | boolean;
  estimated_reach: number;
  estimated_cpm: number;
  package_price: number;
  status: string;
};

type DealRow = {
  id: number;
  first_name: string;
  username: string;
  package_name: string | null;
  campaign_type: string;
  campaign_id: number | null;
  inventory_type: string;
  start_date: string;
  end_date: string;
  fixed_cpm: number;
  total_budget: number;
  daily_cap: number;
  status: string;
  approval_status: string;
  exclusivity_type: string;
  reserved_impressions: number;
  delivered_impressions: number;
  spend: number;
  reservation_count: number;
  reporting: {
    remaining_budget: number;
    delivery_progress: number;
    time_elapsed: number;
    expected_impressions: number;
    underdelivery_status: string;
  };
};

const emptyPackage: PackageRow = {
  name: "",
  description: "",
  miniapp_impressions: 0,
  channel_posts: 0,
  bot_broadcasts: 0,
  featured_marketplace_days: 0,
  priority_support: false,
  estimated_reach: 0,
  estimated_cpm: 0,
  package_price: 0,
  status: "active",
};

function fmt(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function pct(value: unknown) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

export default function AdminEnterprisePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<any>({});
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [filters, setFilters] = useState({ type: "all", tier: "all", search: "" });
  const [packageForm, setPackageForm] = useState<PackageRow>(emptyPackage);
  const [dealForm, setDealForm] = useState({
    advertiser_id: "",
    campaign_type: "campaign",
    campaign_id: "",
    package_id: "",
    start_date: "",
    end_date: "",
    fixed_cpm: "",
    total_budget: "",
    daily_cap: "",
    reserved_impressions: "",
    exclusivity_type: "non_exclusive",
    exclusive_category: "",
    exclusive_country: "",
    overdelivery_allowed: false,
    admin_notes: "",
  });
  const [selectedInventory, setSelectedInventory] = useState<Record<string, boolean>>({});

  const query = useMemo(() => new URLSearchParams(filters).toString(), [filters]);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/enterprise?${query}`);
    const data = await res.json();
    setSummary(data.summary || {});
    setInventory(data.inventory || []);
    setDeals(data.deals || []);
    setPackages(data.packages || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [query]);

  const patchInventory = (key: string, patch: Partial<InventoryRow>) => {
    setInventory((prev) => prev.map((row) => `${row.inventory_type}-${row.id}` === key ? { ...row, ...patch } : row));
  };

  const saveInventory = async (row: InventoryRow) => {
    setSaving(true);
    const res = await fetch("/api/admin/enterprise", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "inventory_tier", inventory_id: row.id, ...row }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Premium inventory controls saved." : data.error || "Failed to save inventory.");
    setSaving(false);
  };

  const savePackage = async () => {
    setSaving(true);
    const res = await fetch("/api/admin/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_package", ...packageForm }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Sponsorship package saved." : data.error || "Failed to save package.");
    setPackageForm(emptyPackage);
    setSaving(false);
    if (res.ok) load();
  };

  const createDeal = async () => {
    const selected = inventory
      .filter((row) => selectedInventory[`${row.inventory_type}-${row.id}`])
      .map((row) => ({ inventory_type: row.inventory_type, inventory_id: row.id }));
    setSaving(true);
    const res = await fetch("/api/admin/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_deal",
        ...dealForm,
        advertiser_id: Number(dealForm.advertiser_id),
        campaign_id: dealForm.campaign_id ? Number(dealForm.campaign_id) : null,
        package_id: dealForm.package_id ? Number(dealForm.package_id) : null,
        selected_inventory: selected,
        inventory_type: selected.length === 1 ? selected[0].inventory_type : "mixed",
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "Direct deal created and reserved pending approval." : data.error || "Failed to create deal.");
    setSaving(false);
    if (res.ok) {
      setSelectedInventory({});
      load();
    }
  };

  const dealAction = async (dealId: number, action: string) => {
    setSaving(true);
    const res = await fetch("/api/admin/enterprise", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, deal_id: dealId }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? `Deal ${action} saved.` : data.error || "Failed to update deal.");
    setSaving(false);
    if (res.ok) load();
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900"><BriefcaseBusiness size={24} /> Enterprise Deals</h1>
            <p className="text-sm font-semibold text-slate-500">Premium inventory, direct deals, reserved placements, sponsorship packages, and admin approval.</p>
          </div>
          {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{message}</div>}
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["Total deals", summary.total_deals],
            ["Pending approval", summary.pending_approvals],
            ["Active deals", summary.active_deals],
            ["Reserved impressions", summary.reserved_impressions],
            ["Delivered", summary.delivered_impressions],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-black text-slate-900">{fmt(value)}</p>
            </div>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-700"><Star size={16} /> Premium Inventory</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              <select value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">
                <option value="all">All types</option>
                <option value="miniapp">Mini Apps</option>
                <option value="channel">Channels</option>
                <option value="bot">Bots</option>
              </select>
              <select value={filters.tier} onChange={(event) => setFilters((prev) => ({ ...prev, tier: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">
                <option value="all">All tiers</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
                <option value="elite">Elite</option>
                <option value="sponsored">Sponsored</option>
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Search" className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-xs font-bold" />
              </div>
            </div>
          </div>

          {loading ? <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Reserve</th>
                    <th className="px-3 py-2">Inventory</th>
                    <th className="px-3 py-2">Tier</th>
                    <th className="px-3 py-2">Priority</th>
                    <th className="px-3 py-2">Sponsored</th>
                    <th className="px-3 py-2">Availability</th>
                    <th className="px-3 py-2">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventory.map((row) => {
                    const key = `${row.inventory_type}-${row.id}`;
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2"><input type="checkbox" checked={Boolean(selectedInventory[key])} onChange={(event) => setSelectedInventory((prev) => ({ ...prev, [key]: event.target.checked }))} /></td>
                        <td className="px-3 py-2">
                          <div className="font-black text-slate-900">{row.name}</div>
                          <div className="text-xs font-semibold text-slate-400">@{row.username || "private"} / {row.inventory_type} / {fmt(row.estimated_monthly_impressions)} reach / ${Number(row.estimated_cpm || 0).toFixed(2)} CPM</div>
                        </td>
                        <td className="px-3 py-2">
                          <select value={row.enterprise_inventory_tier} onChange={(event) => patchInventory(key, { enterprise_inventory_tier: event.target.value })} className="rounded border border-slate-200 px-2 py-1 text-xs">
                            <option value="standard">Standard</option>
                            <option value="premium">Premium</option>
                            <option value="elite">Elite</option>
                            <option value="sponsored">Sponsored</option>
                          </select>
                        </td>
                        <td className="px-3 py-2"><input value={row.enterprise_priority_score} onChange={(event) => patchInventory(key, { enterprise_priority_score: Number(event.target.value) })} className="w-20 rounded border border-slate-200 px-2 py-1 text-xs" /></td>
                        <td className="px-3 py-2"><input type="checkbox" checked={Boolean(row.enterprise_sponsorship_enabled)} onChange={(event) => patchInventory(key, { enterprise_sponsorship_enabled: event.target.checked })} /></td>
                        <td className="px-3 py-2 text-xs font-bold text-slate-500">{row.reservation_count ? `${row.reservation_count} reserved/booked` : "Available"}</td>
                        <td className="px-3 py-2"><button disabled={saving} onClick={() => saveInventory(row)} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:bg-slate-300"><Save size={13} className="mr-1 inline" />Save</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-black uppercase tracking-wider text-slate-700">Create Direct Deal</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={dealForm.advertiser_id} onChange={(event) => setDealForm((prev) => ({ ...prev, advertiser_id: event.target.value }))} placeholder="Advertiser user ID" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.campaign_id} onChange={(event) => setDealForm((prev) => ({ ...prev, campaign_id: event.target.value }))} placeholder="Campaign ID optional" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <select value={dealForm.package_id} onChange={(event) => setDealForm((prev) => ({ ...prev, package_id: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">No package</option>
                {packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
              </select>
              <select value={dealForm.exclusivity_type} onChange={(event) => setDealForm((prev) => ({ ...prev, exclusivity_type: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="non_exclusive">Non-exclusive</option>
                <option value="exclusive">Exclusive</option>
                <option value="category_exclusive">Category-exclusive</option>
                <option value="country_exclusive">Country-exclusive</option>
              </select>
              <input type="date" value={dealForm.start_date} onChange={(event) => setDealForm((prev) => ({ ...prev, start_date: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="date" value={dealForm.end_date} onChange={(event) => setDealForm((prev) => ({ ...prev, end_date: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.fixed_cpm} onChange={(event) => setDealForm((prev) => ({ ...prev, fixed_cpm: event.target.value }))} placeholder="Fixed CPM" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.total_budget} onChange={(event) => setDealForm((prev) => ({ ...prev, total_budget: event.target.value }))} placeholder="Total budget" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.daily_cap} onChange={(event) => setDealForm((prev) => ({ ...prev, daily_cap: event.target.value }))} placeholder="Daily cap" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.reserved_impressions} onChange={(event) => setDealForm((prev) => ({ ...prev, reserved_impressions: event.target.value }))} placeholder="Reserved impressions" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.exclusive_category} onChange={(event) => setDealForm((prev) => ({ ...prev, exclusive_category: event.target.value }))} placeholder="Exclusive category" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={dealForm.exclusive_country} onChange={(event) => setDealForm((prev) => ({ ...prev, exclusive_country: event.target.value }))} placeholder="Exclusive country" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={dealForm.overdelivery_allowed} onChange={(event) => setDealForm((prev) => ({ ...prev, overdelivery_allowed: event.target.checked }))} /> Allow overdelivery</label>
              <button disabled={saving} onClick={createDeal} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">Create reserved deal</button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-4 text-sm font-black uppercase tracking-wider text-slate-700">Sponsorship Packages</h2>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <input value={packageForm.name} onChange={(event) => setPackageForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Package name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.package_price} onChange={(event) => setPackageForm((prev) => ({ ...prev, package_price: Number(event.target.value) }))} placeholder="Price" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.miniapp_impressions} onChange={(event) => setPackageForm((prev) => ({ ...prev, miniapp_impressions: Number(event.target.value) }))} placeholder="Mini App impressions" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.channel_posts} onChange={(event) => setPackageForm((prev) => ({ ...prev, channel_posts: Number(event.target.value) }))} placeholder="Channel posts" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.bot_broadcasts} onChange={(event) => setPackageForm((prev) => ({ ...prev, bot_broadcasts: Number(event.target.value) }))} placeholder="Bot broadcasts" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.featured_marketplace_days} onChange={(event) => setPackageForm((prev) => ({ ...prev, featured_marketplace_days: Number(event.target.value) }))} placeholder="Featured days" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.estimated_reach} onChange={(event) => setPackageForm((prev) => ({ ...prev, estimated_reach: Number(event.target.value) }))} placeholder="Estimated reach" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={packageForm.estimated_cpm} onChange={(event) => setPackageForm((prev) => ({ ...prev, estimated_cpm: Number(event.target.value) }))} placeholder="Estimated CPM" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={Boolean(packageForm.priority_support)} onChange={(event) => setPackageForm((prev) => ({ ...prev, priority_support: event.target.checked }))} /> Priority support</label>
              <button disabled={saving} onClick={savePackage} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">Save package</button>
            </div>
            <div className="grid gap-2">
              {packages.map((pkg) => (
                <button key={pkg.id} onClick={() => setPackageForm(pkg)} className="rounded-lg bg-slate-50 p-3 text-left text-xs font-bold text-slate-600">
                  <span className="text-sm font-black text-slate-900">{pkg.name}</span> / ${Number(pkg.package_price || 0).toFixed(2)} / {fmt(pkg.estimated_reach)} reach
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-700"><ShieldCheck size={16} /> Deals, Reporting & Approval</h2>
          <div className="grid gap-3">
            {deals.map((deal) => (
              <div key={deal.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-slate-900">Deal #{deal.id}</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-500">{deal.approval_status}</span>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">{deal.status}</span>
                      {deal.reporting.underdelivery_status === "at_risk" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-black uppercase text-red-700"><AlertTriangle size={12} className="mr-1 inline" />At risk</span>}
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Advertiser {deal.first_name || deal.username || deal.id} / {deal.package_name || "Custom deal"} / {deal.reservation_count} reserved placements / {deal.exclusivity_type}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">{String(deal.start_date).slice(0, 10)} to {String(deal.end_date).slice(0, 10)} / Fixed CPM ${Number(deal.fixed_cpm || 0).toFixed(2)} / Daily cap ${Number(deal.daily_cap || 0).toFixed(2)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => dealAction(deal.id, "approve")} disabled={saving || deal.approval_status === "approved"} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300"><CheckCircle2 size={13} className="mr-1 inline" />Approve</button>
                    <button onClick={() => dealAction(deal.id, "pause")} disabled={saving || deal.status === "paused"} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300"><Pause size={13} className="mr-1 inline" />Pause</button>
                    <button onClick={() => dealAction(deal.id, "resume")} disabled={saving || deal.status === "active"} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300"><Play size={13} className="mr-1 inline" />Resume</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-5">
                  <div className="rounded-lg bg-slate-50 p-3 text-xs"><b>{fmt(deal.reserved_impressions)}</b><br />Reserved impressions</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-xs"><b>{fmt(deal.delivered_impressions)}</b><br />Delivered impressions</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-xs"><b>{pct(deal.reporting.delivery_progress)}</b><br />Delivery progress</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-xs"><b>${Number(deal.reporting.remaining_budget || 0).toFixed(2)}</b><br />Remaining budget</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-xs"><b>{fmt(deal.reporting.expected_impressions)}</b><br />Expected by now</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
