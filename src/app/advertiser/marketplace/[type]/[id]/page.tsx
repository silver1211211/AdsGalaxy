"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import { ArrowLeft, Bookmark, Bot, CheckCircle2, Loader2, Send, Smartphone, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

type Profile = {
  id: number;
  type: "miniapp" | "channel" | "bot";
  type_label: string;
  name: string;
  username: string;
  category: string;
  country: string;
  language: string;
  inventory_rank: string;
  traffic_quality_rating: string;
  publisher_trust: string;
  monthly_impressions: number;
  average_completion_rate: number;
  average_cpm: number | null;
  direct_min_cpm: number | null;
  premium_cpm: number | null;
  featured_cpm: number | null;
  active_status: string;
  featured: boolean;
  pinned: boolean;
  highlighted: boolean;
  favorite: boolean;
};

function iconFor(type: Profile["type"]) {
  if (type === "miniapp") return Smartphone;
  if (type === "bot") return Bot;
  return Tv;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function money(value: unknown) {
  if (value === null || value === undefined) return "Admin configured";
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function MarketplaceProfilePage() {
  const { setTitle } = useHeader();
  const params = useParams<{ type: string; id: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recommended, setRecommended] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listName, setListName] = useState("");
  const [message, setMessage] = useState("");

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/advertiser/marketplace/${params.type}/${params.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load profile");
      setProfile(data.profile);
      setRecommended(data.recommended || []);
      setTitle(data.profile?.name || "Inventory Profile");
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [params.type, params.id]);

  const saveFavorite = async () => {
    if (!profile) return;
    if (profile.favorite) {
      await apiFetch(`/api/advertiser/marketplace/favorites?inventory_type=${profile.type}&inventory_id=${profile.id}`, { method: "DELETE" });
    } else {
      await apiFetch("/api/advertiser/marketplace/favorites", {
        method: "POST",
        body: JSON.stringify({ inventory_type: profile.type, inventory_id: profile.id }),
      });
    }
    setProfile({ ...profile, favorite: !profile.favorite });
  };

  const createList = async () => {
    if (!profile || !listName.trim()) return;
    const res = await apiFetch("/api/advertiser/marketplace/lists", {
      method: "POST",
      body: JSON.stringify({ name: listName }),
    });
    const data = await res.json();
    if (res.ok) {
      await apiFetch("/api/advertiser/marketplace/lists", {
        method: "PATCH",
        body: JSON.stringify({ list_id: data.id, inventory_type: profile.type, inventory_id: profile.id }),
      });
      setMessage("Inventory list created and item added.");
      setListName("");
    } else {
      setMessage(data.error || "Failed to create list");
    }
  };

  const registerInterest = async () => {
    if (!profile) return;
    await apiFetch("/api/advertiser/marketplace", {
      method: "POST",
      body: JSON.stringify({ inventory_type: profile.type, inventory_id: profile.id, event_type: "advertiser_interest" }),
    });
    setMessage("Interest recorded. You can select this inventory while creating a campaign.");
  };

  if (loading) {
    return (
      <DashboardLayout type="advertiser">
        <div className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
      </DashboardLayout>
    );
  }

  if (!profile) {
    return (
      <DashboardLayout type="advertiser">
        <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm font-semibold text-slate-500">{message || "Inventory not found."}</div>
      </DashboardLayout>
    );
  }

  const Icon = iconFor(profile.type);

  return (
    <DashboardLayout type="advertiser">
      <div className="mx-auto max-w-5xl space-y-6 pb-10">
        <Link href="/advertiser/marketplace" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-blue-600">
          <ArrowLeft size={14} /> Marketplace
        </Link>

        <section className={cn("rounded-2xl border bg-white p-5 shadow-sm", profile.highlighted ? "border-blue-200 ring-4 ring-blue-50" : "border-slate-100")}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Icon size={28} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">{profile.name}</h1>
                  {profile.featured && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black uppercase text-blue-700">Featured</span>}
                  {profile.pinned && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-700">Pinned</span>}
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">@{profile.username || "private"} / {profile.type_label}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveFavorite} className={cn("inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-widest", profile.favorite ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500")}>
                <Bookmark size={15} fill={profile.favorite ? "currentColor" : "none"} /> Save
              </button>
              <button onClick={registerInterest} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
                <Send size={15} /> Interested
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Estimated Reach", numberValue(profile.monthly_impressions)],
              ["Monthly Impressions", numberValue(profile.monthly_impressions)],
              ["Traffic Quality", profile.traffic_quality_rating],
              ["Inventory Rank", profile.inventory_rank],
              ["Publisher Trust", profile.publisher_trust],
              ["Completion Rate", `${profile.average_completion_rate.toFixed(1)}%`],
              ["Average CPM", money(profile.average_cpm)],
              ["Direct Min CPM", money(profile.direct_min_cpm)],
            ].map(([name, value]) => (
              <div key={name} className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{name}</p>
                <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{profile.category}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{profile.country}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{profile.language}</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{profile.active_status}</span>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-slate-900">Create Inventory List</h2>
            <div className="mt-3 flex gap-2">
              <input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="List name" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
              <button onClick={createList} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Create</button>
            </div>
            {message && <p className="mt-3 text-xs font-semibold text-slate-500">{message}</p>}
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 text-xs font-semibold leading-relaxed text-slate-500 shadow-sm">
            <CheckCircle2 size={16} className="mb-2 text-emerald-500" />
            This public profile excludes publisher revenue, earnings, fraud scores, internal CPM formulas, quality formulas, and trust formulas.
          </div>
        </section>

        {recommended.length > 0 && (
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-black text-slate-900">Recommended Similar Inventory</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {recommended.map((item) => (
                <Link key={`${item.type}-${item.id}`} href={`/advertiser/marketplace/${item.type}/${item.id}`} className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-700">
                  {item.name}<br /><span className="text-slate-400">{item.type_label} / {item.traffic_quality_rating}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
