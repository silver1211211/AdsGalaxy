"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import { BriefcaseBusiness, CheckCircle2, Crown, Loader2, ShieldCheck, Sparkles } from "lucide-react";

type PackageRow = {
  id: number;
  name: string;
  description: string | null;
  miniapp_impressions: number;
  channel_posts: number;
  bot_broadcasts: number;
  featured_marketplace_days: number;
  priority_support: number | boolean;
  estimated_reach: number;
  estimated_cpm: number;
  package_price: number;
};

type PremiumOption = {
  inventory_type: string;
  id: number;
  name: string;
  username: string;
  tier: string;
  estimated_reach: number;
  estimated_cpm: number;
  category: string;
  country: string;
  traffic_quality_score: number;
};

function fmt(value: unknown) {
  return Number(value || 0).toLocaleString();
}

export default function AdvertiserEnterprisePage() {
  const { setTitle } = useHeader();
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [premiumOptions, setPremiumOptions] = useState<PremiumOption[]>([]);

  useEffect(() => {
    setTitle("Enterprise");
  }, [setTitle]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await apiFetch("/api/advertiser/enterprise");
      const data = await res.json();
      setPackages(data.packages || []);
      setPremiumOptions(data.premium_options || []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-6 pb-10">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <BriefcaseBusiness size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Enterprise Advertising</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">View premium packages, reserved inventory options, estimated reach, and fixed CPM sponsorship paths.</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
                <ShieldCheck size={13} /> Admin approval required before activation
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : (
          <>
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-500">
                <Crown size={16} className="text-amber-500" /> Sponsorship Packages
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {packages.map((pkg) => (
                  <div key={pkg.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <h2 className="text-lg font-black text-slate-900">{pkg.name}</h2>
                    <p className="mt-1 min-h-10 text-xs font-semibold leading-relaxed text-slate-500">{pkg.description || "Reserved enterprise sponsorship package."}</p>
                    <div className="mt-4 text-2xl font-black text-slate-900">${Number(pkg.package_price || 0).toFixed(2)}</div>
                    <div className="mt-4 grid gap-2 text-xs">
                      <div className="rounded-xl bg-slate-50 p-3"><b>{fmt(pkg.estimated_reach)}</b><br />Estimated reach</div>
                      <div className="rounded-xl bg-slate-50 p-3"><b>${Number(pkg.estimated_cpm || 0).toFixed(2)}</b><br />Estimated CPM</div>
                      <div className="rounded-xl bg-slate-50 p-3"><b>{fmt(pkg.miniapp_impressions)}</b><br />Mini App impressions</div>
                      <div className="rounded-xl bg-slate-50 p-3"><b>{fmt(pkg.channel_posts)} posts / {fmt(pkg.bot_broadcasts)} broadcasts</b><br />Channel and bot delivery</div>
                    </div>
                    <div className="mt-4 space-y-2 text-xs font-bold text-slate-600">
                      <p><CheckCircle2 size={13} className="mr-1 inline text-emerald-500" /> Featured marketplace: {fmt(pkg.featured_marketplace_days)} days</p>
                      <p><CheckCircle2 size={13} className="mr-1 inline text-emerald-500" /> Priority support: {pkg.priority_support ? "Included" : "Available by approval"}</p>
                      <p><CheckCircle2 size={13} className="mr-1 inline text-emerald-500" /> Direct deal setup by admin</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-500">
                <Sparkles size={16} className="text-blue-500" /> Premium Inventory Options
              </div>
              {premiumOptions.length === 0 ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm font-semibold text-slate-500">Premium inventory is being prepared by the admin team.</div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {premiumOptions.map((item) => (
                    <div key={`${item.inventory_type}-${item.id}`} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-black text-slate-900">{item.name}</h3>
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">@{item.username || "private"} / {item.inventory_type}</p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black uppercase text-blue-700">{item.tier}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-slate-50 p-3"><b>{fmt(item.estimated_reach)}</b><br />Estimated reach</div>
                        <div className="rounded-xl bg-slate-50 p-3"><b>${Number(item.estimated_cpm || 0).toFixed(2)}</b><br />Estimated CPM</div>
                        <div className="rounded-xl bg-slate-50 p-3"><b>{item.category}</b><br />Category</div>
                        <div className="rounded-xl bg-slate-50 p-3"><b>{item.country || "Global"}</b><br />Country</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="rounded-2xl border border-slate-100 bg-white p-4 text-xs font-semibold leading-relaxed text-slate-500">
          Enterprise packages and premium inventory are visible for planning only. Admins create, reserve, approve, pause, and resume all enterprise deals, and delivery still obeys budget limits, pacing, fraud checks, inventory health, and pause status.
        </div>
      </div>
    </DashboardLayout>
  );
}
