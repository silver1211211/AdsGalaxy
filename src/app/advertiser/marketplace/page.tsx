"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import { apiFetch } from "@/lib/api";
import { Bot, Bookmark, Check, Crown, Filter, Flame, Loader2, Search, Smartphone, Star, Trophy, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

type InventoryItem = {
  id: number;
  type: "miniapp" | "channel" | "bot";
  type_label: string;
  name: string;
  username: string;
  category: string;
  country: string;
  language: string;
  inventory_rank: string;
  inventory_rank_key: string;
  traffic_quality_rating: string;
  publisher_trust: string;
  monthly_impressions: number;
  average_completion_rate: number;
  average_cpm: number | null;
  active_status: string;
  featured: boolean;
  pinned: boolean;
  highlighted: boolean;
  favorite: boolean;
};

const tabs = [
  { key: "all", label: "All" },
  { key: "miniapp", label: "Mini Apps" },
  { key: "channel", label: "Channels" },
  { key: "bot", label: "Bots" },
];

const ranks = ["", "elite", "advanced", "standard", "basic", "starter"];
const quality = ["", "excellent", "very_good", "good", "average", "poor"];

function iconFor(type: InventoryItem["type"]) {
  if (type === "miniapp") return Smartphone;
  if (type === "bot") return Bot;
  return Tv;
}

function numberValue(value: unknown) {
  return Number(value || 0).toLocaleString();
}

function label(value: string) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Any";
}

function InventoryCard({ item, onFavorite }: { item: InventoryItem; onFavorite: (item: InventoryItem) => void }) {
  const Icon = iconFor(item.type);
  return (
    <div className={cn("rounded-2xl border bg-white p-4 shadow-sm", item.highlighted ? "border-blue-200 ring-4 ring-blue-50" : "border-slate-100")}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/advertiser/marketplace/${item.type}/${item.id}`} className="truncate text-sm font-black text-slate-900 hover:text-blue-600">
              {item.name}
            </Link>
            {item.pinned && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase text-amber-700">Pinned</span>}
            {item.featured && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase text-blue-700">Featured</span>}
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">@{item.username || "private"} / {item.type_label}</p>
        </div>
        <button
          onClick={() => onFavorite(item)}
          className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", item.favorite ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 text-slate-400")}
          title="Save inventory"
        >
          <Bookmark size={16} fill={item.favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-slate-50 p-3"><p className="font-black text-slate-900">{numberValue(item.monthly_impressions)}</p><p className="font-bold uppercase text-slate-400">Monthly impressions</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="font-black text-slate-900">{item.traffic_quality_rating}</p><p className="font-bold uppercase text-slate-400">Traffic quality</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="font-black text-slate-900">{item.inventory_rank}</p><p className="font-bold uppercase text-slate-400">Inventory rank</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="font-black text-slate-900">{item.average_completion_rate.toFixed(1)}%</p><p className="font-bold uppercase text-slate-400">Completion</p></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-1">{item.category}</span>
        <span className="rounded-full bg-slate-100 px-2 py-1">{item.country}</span>
        <span className="rounded-full bg-slate-100 px-2 py-1">{item.language}</span>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{item.active_status}</span>
      </div>
    </div>
  );
}

export default function AdvertiserMarketplacePage() {
  const { setTitle } = useHeader();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [top, setTop] = useState<InventoryItem[]>([]);
  const [trending, setTrending] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    type: "all",
    search: "",
    category: "",
    country: "",
    language: "",
    inventory_rank: "",
    traffic_quality: "",
    publisher_trust: "",
    min_cpm: "",
    max_cpm: "",
    min_impressions: "",
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("limit", "48");
    return params.toString();
  }, [filters]);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const [marketRes, topRes, trendingRes] = await Promise.all([
        apiFetch(`/api/advertiser/marketplace?${query}`),
        apiFetch("/api/advertiser/marketplace?leaderboard=1&limit=9"),
        apiFetch("/api/advertiser/marketplace?trending=1&limit=9"),
      ]);
      const [marketData, topData, trendingData] = await Promise.all([marketRes.json(), topRes.json(), trendingRes.json()]);
      if (!marketRes.ok) throw new Error(marketData.error || "Failed to load marketplace");
      setItems(marketData.inventory || []);
      setTop(topData.inventory || []);
      setTrending(trendingData.inventory || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTitle("Marketplace");
  }, [setTitle]);

  useEffect(() => {
    fetchInventory();
  }, [query]);

  const saveFavorite = async (item: InventoryItem) => {
    if (item.favorite) {
      await apiFetch(`/api/advertiser/marketplace/favorites?inventory_type=${item.type}&inventory_id=${item.id}`, { method: "DELETE" });
    } else {
      await apiFetch("/api/advertiser/marketplace/favorites", {
        method: "POST",
        body: JSON.stringify({ inventory_type: item.type, inventory_id: item.id }),
      });
    }
    setItems((prev) => prev.map((row) => row.type === item.type && row.id === item.id ? { ...row, favorite: !row.favorite } : row));
  };

  return (
    <DashboardLayout type="advertiser">
      <div className="space-y-6 pb-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Publisher Marketplace</h1>
            <p className="text-sm font-semibold text-slate-500">Discover Mini Apps, Channels, and Bots before choosing campaign placement.</p>
          </div>
          <Link href="/advertiser/campaigns/new" className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">
            Create Campaign
          </Link>
        </div>

        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilters((prev) => ({ ...prev, type: tab.key }))}
              className={cn("shrink-0 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wider", filters.type === tab.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400"><Filter size={14} /> Search & Filters</div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Name, username, category, country, language, rank" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-semibold outline-none focus:border-blue-500" />
            </div>
            <input value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))} placeholder="Category" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            <input value={filters.country} onChange={(event) => setFilters((prev) => ({ ...prev, country: event.target.value }))} placeholder="Country, e.g. US" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            <input value={filters.language} onChange={(event) => setFilters((prev) => ({ ...prev, language: event.target.value }))} placeholder="Language, e.g. en" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            <select value={filters.inventory_rank} onChange={(event) => setFilters((prev) => ({ ...prev, inventory_rank: event.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500">
              {ranks.map((rank) => <option key={rank} value={rank}>Rank: {label(rank)}</option>)}
            </select>
            <select value={filters.traffic_quality} onChange={(event) => setFilters((prev) => ({ ...prev, traffic_quality: event.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500">
              {quality.map((item) => <option key={item} value={item}>Traffic: {label(item)}</option>)}
            </select>
            <select value={filters.publisher_trust} onChange={(event) => setFilters((prev) => ({ ...prev, publisher_trust: event.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500">
              {ranks.map((rank) => <option key={rank} value={rank}>Trust: {label(rank)}</option>)}
            </select>
            <input value={filters.min_cpm} onChange={(event) => setFilters((prev) => ({ ...prev, min_cpm: event.target.value }))} placeholder="Min average CPM" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            <input value={filters.max_cpm} onChange={(event) => setFilters((prev) => ({ ...prev, max_cpm: event.target.value }))} placeholder="Max average CPM" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            <input value={filters.min_impressions} onChange={(event) => setFilters((prev) => ({ ...prev, min_impressions: event.target.value }))} placeholder="Min monthly impressions" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Trophy size={16} className="text-amber-500" /> Top Inventory</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {top.slice(0, 3).map((item) => <Link key={`${item.type}-${item.id}`} href={`/advertiser/marketplace/${item.type}/${item.id}`} className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-700"><Crown size={14} className="mb-2 text-amber-500" />{item.name}<br /><span className="text-slate-400">{item.type_label}</span></Link>)}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><Flame size={16} className="text-orange-500" /> Trending Inventory</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {trending.slice(0, 3).map((item) => <Link key={`${item.type}-${item.id}`} href={`/advertiser/marketplace/${item.type}/${item.id}`} className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-700"><Star size={14} className="mb-2 text-orange-500" />{item.name}<br /><span className="text-slate-400">{item.type_label}</span></Link>)}
            </div>
          </section>
        </div>

        {loading ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" size={28} /></div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm font-semibold text-slate-500">No public inventory matches your filters.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => <InventoryCard key={`${item.type}-${item.id}`} item={item} onFavorite={saveFavorite} />)}
          </div>
        )}

        <div className="rounded-2xl border border-slate-100 bg-white p-4 text-xs font-semibold leading-relaxed text-slate-500">
          <Check size={14} className="mr-1 inline text-emerald-500" />
          Public profiles show advertiser-facing quality labels, reach, rank, category, language, and country. Revenue, earnings, fraud scores, and internal formulas are not exposed.
        </div>
      </div>
    </DashboardLayout>
  );
}
