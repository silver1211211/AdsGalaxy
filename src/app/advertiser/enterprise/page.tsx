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
                  <div key={pkg.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    {/* Card header */}
                    <div className="bg-gradient-to-br from-[#0c9de8] to-[#0b7ec9] px-5 pt-5 pb-4">
                      <h2 className="text-base font-black uppercase tracking-wide text-white">{pkg.name}</h2>
                      <p className="mt-1 text-[11px] font-medium leading-relaxed text-blue-100">{pkg.description || "Reserved enterprise sponsorship package."}</p>
                      <div className="mt-3 text-3xl font-black text-white">${Number(pkg.package_price || 0).toFixed(2)}</div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-t border-slate-100">
                      <div className="bg-slate-50 px-4 py-3">
                        <p className="text-base font-black text-blue-600">{fmt(pkg.estimated_reach)}</p>
                        <p className="text-[10px] font-bold text-slate-500">Est. Reach</p>
                      </div>
                      <div className="bg-slate-50 px-4 py-3">
                        <p className="text-base font-black text-emerald-600">${Number(pkg.estimated_cpm || 0).toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-slate-500">Est. CPM</p>
                      </div>
                      <div className="bg-slate-50 px-4 py-3">
                        <p className="text-base font-black text-violet-600">{fmt(pkg.miniapp_impressions)}</p>
                        <p className="text-[10px] font-bold text-slate-500">Mini App Views</p>
                      </div>
                      <div className="bg-slate-50 px-4 py-3">
                        <p className="text-base font-black text-amber-600">{fmt(pkg.channel_posts)}p / {fmt(pkg.bot_broadcasts)}b</p>
                        <p className="text-[10px] font-bold text-slate-500">Delivery</p>
                      </div>
                    </div>

                    {/* Included features */}
                    <div className="flex flex-col gap-2 p-4 border-t border-slate-100">
                      {[
                        `Featured marketplace: ${fmt(pkg.featured_marketplace_days)} days`,
                        `Priority support: ${pkg.priority_support ? "Included" : "By approval"}`,
                        "Direct deal setup by admin",
                      ].map(f => (
                        <p key={f} className="flex items-start gap-1.5 text-xs font-semibold text-slate-700">
                          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                          {f}
                        </p>
                      ))}
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
                    <div key={`${item.inventory_type}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-[#0c9de8] to-[#0b7ec9] px-5 py-4">
                        <div>
                          <h3 className="font-black text-white">{item.name}</h3>
                          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-100">
                            {item.inventory_type} inventory
                          </p>
                          <p className="hidden">
                            {item.inventory_type} inventory
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-black uppercase text-white">
                          {item.tier}
                        </span>
                      </div>
                      {/* Stats */}
                      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-t border-slate-100">
                        <div className="bg-slate-50 px-3 py-3">
                          <p className="text-sm font-black text-blue-600">{fmt(item.estimated_reach)}</p>
                          <p className="text-[10px] font-bold text-slate-500">Est. Reach</p>
                        </div>
                        <div className="bg-slate-50 px-3 py-3">
                          <p className="text-sm font-black text-emerald-600">${Number(item.estimated_cpm || 0).toFixed(2)}</p>
                          <p className="text-[10px] font-bold text-slate-500">Est. CPM</p>
                        </div>
                        <div className="bg-slate-50 px-3 py-3">
                          <p className="text-sm font-black text-violet-600">{item.category}</p>
                          <p className="text-[10px] font-bold text-slate-500">Category</p>
                        </div>
                        <div className="bg-slate-50 px-3 py-3">
                          <p className="text-sm font-black text-amber-600">{item.country || "Global"}</p>
                          <p className="text-[10px] font-bold text-slate-500">Country</p>
                        </div>
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
