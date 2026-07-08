"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  PlusCircle,
  Upload,
  Check,
  AlertCircle,
  Loader2,
  Globe,
  Type,
  Link as LinkIcon,
  DollarSign,
  Trash2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ArrowLeft,
  Bot,
  ArrowUpRight,
  Eye,
  Heart,
  MousePointer2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { ALL_CATEGORIES, CAMPAIGN_CATEGORY_OPTIONS, campaignCategoryLabel } from "@/lib/campaignCategories";
import { composeCampaignCreativeText, hasRestrictedClickCreativeContent } from "@/lib/campaignCreative";

const BUTTON_TEXTS = ["Learn more", "Get started", "Join channel", "Join group", "Start bot", "Buy Now", "Sign Up", "Download", "Visit site", "Play now", "Shop now"];
const CONTINENTS = [
  { id: "global", name: "Global", countries: "All countries" },
  { id: "africa", name: "Africa", countries: "Nigeria, South Africa, Egypt, etc." },
  { id: "asia", name: "Asia", countries: "India, China, Vietnam, etc." },
  { id: "europe", name: "Europe", countries: "UK, Germany, France, etc." },
  { id: "north_america", name: "North America", countries: "USA, Canada" },
  { id: "south_america", name: "South America", countries: "Brazil, Argentina" },
  { id: "oceania", name: "Oceania", countries: "Australia, NZ, Fiji, etc." },
];

type MarketplaceItem = {
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
  monthly_impressions: number;
};

export default function NewCampaignWizardPage() {
  const { setTitle } = useHeader();
  const router = useRouter();
  const params = useParams<{ kind: string }>();
  const searchParams = useSearchParams();
  const isBotCampaign = params.kind === "bot";
  const presetType = searchParams.get("type");
  const defaultType = isBotCampaign ? "broadcast" : (presetType === "clicks" ? "clicks" : "views");

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [showAdPreview, setShowAdPreview] = useState(false);
  const [error, setError] = useState("");
  const [limits, setLimits] = useState({
    min_cpm_views: 0.5,
    max_cpm_views: 5.0,
    min_cpm_clicks: 2,
    max_cpm_clicks: 20.0,
    min_cpm_broadcast: 1.0,
    max_cpm_broadcast: 10.0,
    min_budget: 10,
    recommended_cpm_views: 1.5,
    recommended_cpm_clicks: 5.0,
    recommended_cpm_broadcast: 3.0,
  });

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    campaign_title: "",
    category: ALL_CATEGORIES,
    type: defaultType,
    parse_mode: "none",
    message_text: "",
    link: "",
    postback_url: "",
    button_text: "",
    budget: "",
    cpm: "",
    cpc: "",
    continents: CONTINENTS.map(c => c.id),
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
    excluded_inventory: "",
  });

  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [targetingOpen, setTargetingOpen] = useState(false);
  const [recommendedInventory, setRecommendedInventory] = useState<MarketplaceItem[]>([]);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<number[]>([]);

  useEffect(() => {
    setTitle(isBotCampaign ? "Bot Campaign" : "Channel Campaign");
    let cancelled = false;

    apiFetch("/api/settings")
      .then((res) => res.json().then((data) => ({ data, ok: res.ok })))
      .then(({ data, ok }) => {
        if (!ok || cancelled) return;
        const recViews = parseFloat(data.recommended_cpm_views || "1.5");
        const recClicks = parseFloat(data.recommended_cpm_clicks || "5.0");
        const recBroadcast = parseFloat(data.recommended_cpm_broadcast || "3.0");
        setLimits({
          min_cpm_views: parseFloat(data.min_cpm_views || "0.5"),
          max_cpm_views: parseFloat(data.max_cpm_views || "5.0"),
          min_cpm_clicks: parseFloat(data.min_cpm_clicks || "2.0"),
          max_cpm_clicks: parseFloat(data.max_cpm_clicks || "20.0"),
          min_cpm_broadcast: parseFloat(data.min_cpm_broadcast || "1.0"),
          max_cpm_broadcast: parseFloat(data.max_cpm_broadcast || "10.0"),
          min_budget: parseFloat(data.min_campaign_budget || "10.0"),
          recommended_cpm_views: recViews,
          recommended_cpm_clicks: recClicks,
          recommended_cpm_broadcast: recBroadcast,
        });
        const defaultCpm = isBotCampaign
          ? recBroadcast.toString()
          : presetType === "clicks" ? recClicks.toString() : recViews.toString();
        setFormData(prev => ({
          ...prev,
          cpm: defaultCpm,
          cpc: presetType === "clicks" ? recClicks.toString() : "",
          budget: data.min_campaign_budget || "10.0"
        }));
      })
      .catch((err) => console.error("Failed to fetch settings:", err));

    return () => {
      cancelled = true;
    };
  }, [isBotCampaign, setTitle]);

  useEffect(() => {
    if (!categoryDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!categoryDropdownRef.current?.contains(event.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    };

    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [categoryDropdownOpen]);

  useEffect(() => {
    if (step !== 3) return;

    const query = new URLSearchParams({
      type: isBotCampaign ? "bot" : "channel",
      category: formData.category,
      countries: formData.countries,
      languages: formData.languages,
      budget: formData.budget,
    });

    apiFetch(`/api/advertiser/marketplace/recommended?${query.toString()}`)
      .then((res) => res.json())
      .then((data) => setRecommendedInventory(data.inventory || []))
      .catch(() => setRecommendedInventory([]));
  }, [step, isBotCampaign, formData.category, formData.countries, formData.languages, formData.budget]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        setError("Image size cannot exceed 1MB");
        return;
      }
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
      setError("");
    }
  };

  const checkRestrictedContent = (text: string) => {
    if (formData.type !== "clicks") return false;
    return hasRestrictedClickCreativeContent(text);
  };

  const hasValidCampaignObjective = () => {
    if (isBotCampaign) return formData.type === "broadcast";
    return formData.type === "views" || formData.type === "clicks";
  };

  const handleSubmit = async () => {
    const trimmedName = (formData.name || "").trim();
    const trimmedCampaignTitle = (formData.campaign_title || "").trim();
    if (trimmedName.length < 3) {
      setError("Campaign name must be at least 3 characters.");
      return;
    }
    if (trimmedName.length > 50) {
      setError("Campaign name must be at most 50 characters.");
      return;
    }
    if (trimmedCampaignTitle.length < 3) {
      setError("Campaign title must be at least 3 characters.");
      return;
    }
    if (trimmedCampaignTitle.length > 255) {
      setError("Campaign title must be at most 255 characters.");
      return;
    }

    if (!hasValidCampaignObjective()) {
      setError(isBotCampaign ? "Bot campaign format is required" : "Please select View Campaign or Click Campaign");
      return;
    }
    if (!formData.button_text) {
      setError("Please select a button text");
      return;
    }
    if (!Number.isFinite(Number(formData.budget)) || Number(formData.budget) < 10) {
      setError("Total budget must be at least $10.");
      return;
    }
    if (!formData.message_text.trim()) {
      setError("Message text is required.");
      return;
    }
    if (formData.message_text.length > 1000) {
      setError("Message text must be at most 1000 characters.");
      return;
    }

    if (checkRestrictedContent(formData.campaign_title) || checkRestrictedContent(formData.message_text)) {
      setError("Click campaigns cannot contain usernames (@) or links in the campaign title or message text.");
      return;
    }
    if (formData.start_at && formData.end_at && new Date(formData.start_at).getTime() >= new Date(formData.end_at).getTime()) {
      setError("Start date must be before end date.");
      return;
    }
    if (formData.daily_budget_limit && Number(formData.daily_budget_limit) > Number(formData.budget || 0)) {
      setError("Daily budget cannot exceed total campaign budget.");
      return;
    }
    if (formData.daily_budget_limit && Number(formData.daily_budget_limit) < 10) {
      setError("Daily budget must be at least $10 when provided.");
      return;
    }
    if (formData.frequency_cap_per_user && (!Number.isInteger(Number(formData.frequency_cap_per_user)) || Number(formData.frequency_cap_per_user) <= 0)) {
      setError("Frequency cap must be a positive whole number.");
      return;
    }
    setIsLoading(true);
    setError("");

    const submitData = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      if (key === "continents") {
        submitData.append(key, JSON.stringify(value));
      } else {
        submitData.append(key, value.toString());
      }
    });

    if (image) {
      submitData.append("image", image);
    }
    submitData.set("direct_placement_mode", "network");
    submitData.set("direct_inventory_scope", "network");
    submitData.append("direct_inventory_type", isBotCampaign ? "bot" : "channel");
    submitData.append("direct_inventory_ids", JSON.stringify([]));

    try {
      const res = await apiFetch("/api/advertiser/campaigns", {
        method: "POST",
        body: submitData,
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/advertiser/campaigns");
      } else {
        setError(data.error);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const isValidUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      const hasProtocol = parsed.protocol === "http:" || parsed.protocol === "https:";
      const hasDot = parsed.hostname.includes('.') && !parsed.hostname.endsWith('.');
      return hasProtocol && hasDot;
    } catch {
      return false;
    }
  };

  const toggleContinent = (id: string) => {
    setFormData(prev => {
      let newCons = [...prev.continents];

      if (id === "global") {
        const isGlobal = newCons.includes("global");
        if (isGlobal) {
          return { ...prev, continents: [] };
        } else {
          return { ...prev, continents: CONTINENTS.map(c => c.id) };
        }
      }

      if (newCons.includes(id)) {
        newCons = newCons.filter(c => c !== id && c !== "global");
      } else {
        newCons.push(id);
        const allSpecific = CONTINENTS.filter(c => c.id !== "global").map(c => c.id);
        if (allSpecific.every(sid => newCons.includes(sid))) {
          newCons.push("global");
        }
      }
      return { ...prev, continents: newCons };
    });
  };

  const toggleInventory = (id: number) => {
    setSelectedInventoryIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
    setFormData((prev) => ({ ...prev, direct_placement_mode: "direct", direct_inventory_scope: "inventory" }));
  };

  const advancedTextFields: Array<{ label: string; key: "countries" | "languages"; placeholder: string; hint: string }> = [
    { label: "Countries", key: "countries", placeholder: "e.g. US, NG, GB", hint: "Comma-separated ISO codes" },
    { label: "Languages", key: "languages", placeholder: "e.g. en, fr, es", hint: "Comma-separated language codes" },
  ];

  const policyFields: Array<{ label: string; key: "vpn_policy" | "device_policy" | "os_policy"; opts: Array<[string, string]> }> = [
    { label: "VPN Traffic", key: "vpn_policy", opts: [["allow_all", "Allow all"], ["prefer_non_vpn", "Prefer non-VPN"], ["exclude_vpn", "Exclude VPN"]] },
    { label: "Device Type", key: "device_policy", opts: [["all", "All devices"], ["mobile", "Mobile only"], ["desktop", "Desktop only"]] },
    { label: "Platform / OS", key: "os_policy", opts: [["all", "All platforms"], ["android", "Android"], ["ios", "iOS"], ["desktop_web", "Desktop/Web"]] },
  ];

  return (
    <DashboardLayout type="advertiser">
      <div className="max-w-3xl mx-auto space-y-8 pb-12">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#0c9de8] px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-sm">
            {isBotCampaign ? <Bot size={14} /> : <Globe size={14} />}
            {isBotCampaign ? "Bot Campaign" : "Channel Campaign"}
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tight text-slate-900">
            {isBotCampaign ? "Create Bot Ad" : "Create Channel Ad"}
          </h1>
          <p className="text-sm font-semibold text-slate-500">
            Build your campaign creative, targeting, and budget.
          </p>
        </div>

        {/* Step Bar */}
        {(() => {
          const labels = isBotCampaign
            ? ["Campaign", "Ad Creative", "Budget"]
            : ["Campaign", "Ad Creative", "Budget"];
          return (
            <div className="flex items-center gap-0">
              {labels.map((label, i) => {
                const idx = i + 1;
                const done = step > idx;
                const active = step === idx;
                return (
                  <Fragment key={label}>
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black transition-all",
                          done || active ? "text-white" : "bg-slate-100 text-slate-400"
                        )}
                        style={done || active ? { background: "linear-gradient(135deg,#0c9de8,#0b7ec9)" } : {}}
                      >
                        {done ? <Check size={14} /> : idx}
                      </div>
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-wide whitespace-nowrap",
                        active ? "text-[#0c9de8]" : done ? "text-slate-400" : "text-slate-300"
                      )}>
                        {label}
                      </span>
                    </div>
                    {i < labels.length - 1 && (
                      <div
                        className="flex-1 h-0.5 mb-5 mx-1.5"
                        style={{ background: step > idx ? "#0c9de8" : "#e2e8f0" }}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
          );
        })()}

        <Modal
          isOpen={!!error}
          onClose={() => setError("")}
          type="error"
          title="Validation Error"
        >
          {error}
        </Modal>

        {showAdPreview && (
          <div className="fixed inset-0 z-[590] flex items-center justify-center p-4 sm:p-6">
            <button
              type="button"
              aria-label="Close ad preview"
              onClick={() => setShowAdPreview(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            <div className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ad Preview</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{isBotCampaign ? "Bot sponsored message" : "Channel sponsored post"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdPreview(false)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
              <div
                className="max-h-[78vh] overflow-y-auto bg-[#aad18a] p-4 sm:p-6"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 12px 12px, rgba(255,255,255,.22) 0 1px, transparent 1.5px), radial-gradient(circle at 34px 30px, rgba(54,115,54,.18) 0 1px, transparent 1.5px)",
                  backgroundSize: "46px 46px",
                }}
              >
                <div className="mx-auto max-w-[430px]">
                  <div className="overflow-hidden rounded-2xl rounded-bl-md bg-white shadow-lg">
                    {imagePreview && (
                      <img
                        src={imagePreview}
                        alt="Ad preview"
                        className="aspect-video w-full object-cover"
                      />
                    )}
                    <div className="space-y-3 p-4">
                      <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed text-slate-950 sm:text-base">
                        {composeCampaignCreativeText(formData.campaign_title, formData.message_text) || "Your advertisement message will appear here."}
                      </p>

                      {/* Reactions row — channels only */}
                      {!isBotCampaign && (
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { emoji: "👍", count: "2.1K" },
                            { emoji: "❤️", count: "1.4K" },
                            { emoji: "🔥", count: "891" },
                            { emoji: "🎉", count: "543" },
                            { emoji: "😍", count: "312" },
                            { emoji: "😂", count: "178" },
                          ].map(({ emoji, count }) => (
                            <span
                              key={emoji}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-slate-700"
                            >
                              {emoji} {count}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Views + time */}
                      <div className="flex items-center justify-end gap-2 text-[11px] font-medium text-slate-400">
                        <Eye size={13} className="text-slate-400" />
                        <span className="font-bold text-slate-500">22.5K</span>
                        <span>1:59 PM</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2">
                    {[formData.button_text || "Sign Up", "Advertise with Ads galaxy"].map((label) => (
                      <button
                        key={label}
                        type="button"
                        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#5f9f48]/70 px-4 py-3 text-center text-base font-bold text-white shadow-sm backdrop-blur transition-colors hover:bg-[#4d8d3a]/80"
                      >
                        <span className="min-w-0 truncate">{label}</span>
                        <ArrowUpRight size={18} className="shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">

            {/* Campaign type pill */}
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white" style={{ background: "#0c9de8" }}>
              {isBotCampaign ? <Bot size={13} /> : formData.type === "views" ? <Eye size={13} /> : <MousePointer2 size={13} />}
              {isBotCampaign ? "Bot Campaign" : formData.type === "views" ? "Views Campaign" : "Click Campaign"}
            </div>

            {/* Campaign Name card */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Campaign Name <span className="text-red-400">*</span>
                </label>
                <span className={cn(
                  "text-[10px] font-bold",
                  formData.name.length > 0 && formData.name.trim().length < 3 ? "text-red-400" : "text-slate-300"
                )}>
                  {formData.name.length}/50
                </span>
              </div>
              <div className="relative">
                <Type size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Summer Crypto Promotion"
                  maxLength={50}
                  className={cn(
                    "w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-xl outline-none text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400",
                    formData.name.length > 0 && formData.name.trim().length < 3
                      ? "border-red-300 focus:border-red-400"
                      : "border-slate-200 focus:border-[#0c9de8]"
                  )}
                />
              </div>
              {formData.name.length > 0 && formData.name.trim().length < 3 && (
                <p className="text-[11px] font-bold text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> Minimum 3 characters required
                </p>
              )}
            </div>

            {/* Category card */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Category
              </label>
              <div className="relative" ref={categoryDropdownRef}>
                <Globe size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 z-10 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setCategoryDropdownOpen((prev) => !prev)}
                  className={cn(
                    "w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-xl text-sm font-semibold cursor-pointer flex items-center justify-between text-left transition-colors",
                    formData.category ? "text-slate-900 border-slate-200" : "text-slate-400 border-slate-200",
                    categoryDropdownOpen ? "border-[#0c9de8]" : ""
                  )}
                >
                  {campaignCategoryLabel(formData.category)}
                  <ChevronDown size={16} className={cn("text-slate-400 transition-transform shrink-0", categoryDropdownOpen && "rotate-180")} />
                </button>
                {categoryDropdownOpen && (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {CAMPAIGN_CATEGORY_OPTIONS.map((cat) => (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={() => { setFormData({ ...formData, category: cat.value }); setCategoryDropdownOpen(false); }}
                        className={cn(
                          "w-full px-4 py-2.5 text-left text-sm font-semibold transition-colors",
                          formData.category === cat.value ? "bg-blue-50 text-[#0c9de8] font-bold" : "text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Objective / format info card */}
            <div className="rounded-2xl border bg-white shadow-sm p-5 flex items-center gap-4"
              style={{ borderColor: "#e0f2fe" }}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "#e0f2fe" }}>
                {isBotCampaign ? <Bot size={20} className="text-[#0c9de8]" /> : formData.type === "views" ? <Eye size={20} className="text-[#0c9de8]" /> : <MousePointer2 size={20} className="text-[#0c9de8]" />}
              </div>
              <div>
                <p className="text-sm font-black text-slate-800">
                  {isBotCampaign ? "Broadcast" : formData.type === "views" ? "Pay per View" : "Pay per Click"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isBotCampaign
                    ? "Your post is sent directly to bot subscribers."
                    : formData.type === "views"
                    ? "You pay for every 1,000 channel post views — great for reach."
                    : "You pay for each button or link click — great for conversions."}
                </p>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={
                formData.name.trim().length < 3 ||
                !hasValidCampaignObjective()
              }
              className="w-full py-4 text-white rounded-2xl text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-all active:scale-[0.98]"
              style={{ background: (formData.name.trim().length < 3 || !hasValidCampaignObjective()) ? undefined : "#0c9de8" }}
            >
              Next Step <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* Step 2: Content */}
        {step === 2 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Ad Content</h2>
              <p className="text-slate-400 text-sm mt-1">Write your message, upload an image, and set your link.</p>
            </div>

            {/* Click campaign rule banner */}
            {formData.type === "clicks" && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-amber-700 leading-relaxed">
                  <span className="font-black">Click campaigns:</span> your campaign title and message text must not contain any URLs or @usernames. Put your destination link in the Campaign Link field below — only one URL per ad is allowed.
                </p>
              </div>
            )}

            {/* ── Message ── */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign Title <span className="text-red-400">*</span></p>
                <span className={cn(
                  "text-[10px] font-bold",
                  formData.campaign_title.length > 255 || (formData.campaign_title.length > 0 && formData.campaign_title.trim().length < 3) ? "text-red-400" : "text-slate-300"
                )}>
                  {formData.campaign_title.trim().length}/255
                </span>
              </div>
              <input
                type="text"
                value={formData.campaign_title}
                onChange={(e) => setFormData({ ...formData, campaign_title: e.target.value })}
                placeholder="Monetize your Telegram mini app"
                className={cn(
                  "w-full px-4 py-3.5 bg-slate-50 border rounded-xl focus:border-[#0c9de8] outline-none text-sm font-medium text-slate-900 transition-all",
                  formData.campaign_title.length > 255 || (formData.campaign_title.length > 0 && formData.campaign_title.trim().length < 3) || checkRestrictedContent(formData.campaign_title)
                    ? "border-red-400 bg-red-50/30"
                    : "border-slate-200"
                )}
              />
              {formData.campaign_title.length > 0 && formData.campaign_title.trim().length < 3 && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500 shrink-0" />
                  <p className="text-[11px] font-bold text-red-600">Campaign title must be at least 3 characters.</p>
                </div>
              )}
              {formData.campaign_title.length > 255 && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500 shrink-0" />
                  <p className="text-[11px] font-bold text-red-600">Campaign title must be at most 255 characters.</p>
                </div>
              )}
              {checkRestrictedContent(formData.campaign_title) && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500 shrink-0" />
                  <p className="text-[11px] font-bold text-red-600">Remove all URLs and @usernames from the campaign title - only the Campaign Link field may contain your URL.</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Message Text <span className="text-red-400">*</span></p>
                <span className={cn(
                  "text-[10px] font-bold",
                  formData.message_text.length > 1000 ? "text-red-400" : "text-slate-300"
                )}>{formData.message_text.length}/1000</span>
              </div>

              <textarea
                value={formData.message_text}
                onChange={(e) => setFormData({ ...formData, message_text: e.target.value })}
                rows={6}
                placeholder="Your advertisement message here…"
                className={cn(
                  "w-full px-4 py-3.5 bg-slate-50 border rounded-xl focus:border-[#0c9de8] outline-none text-sm font-medium text-slate-900 transition-all resize-none",
                  checkRestrictedContent(formData.message_text) || formData.message_text.length > 1000 ? "border-red-400 bg-red-50/30" : "border-slate-200"
                )}
              />

              {formData.message_text.length > 1000 && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500 shrink-0" />
                  <p className="text-[11px] font-bold text-red-600">Message text must be at most 1000 characters.</p>
                </div>
              )}

              {checkRestrictedContent(formData.message_text) && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500 shrink-0" />
                  <p className="text-[11px] font-bold text-red-600">Remove all URLs and @usernames from the message text — only the Campaign Link field may contain your URL.</p>
                </div>
              )}

            </div>

            {/* ── Image upload ── */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ad Image <span className="text-slate-300 font-medium normal-case">· optional · max 1 MB · PNG / JPG</span></p>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative border-2 border-dashed rounded-xl h-44 flex flex-col items-center justify-center gap-3 cursor-pointer group transition-all",
                  imagePreview ? "border-[#0c9de8]/40 bg-blue-50/20" : "border-slate-200 hover:border-[#0c9de8]/50 hover:bg-slate-50"
                )}
              >
                {imagePreview ? (
                  <>
                    <img src={imagePreview} alt="Preview" className="h-full w-full object-contain p-2 rounded-xl" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setImage(null); setImagePreview(null); }}
                      className="absolute top-3 right-3 p-1.5 bg-white shadow-md text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-[#0c9de8] group-hover:bg-blue-50 transition-colors">
                      <Upload size={22} />
                    </div>
                    <p className="text-sm font-black text-slate-500 group-hover:text-slate-700 transition-colors">Click to upload image</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={handleImageChange} />
              </div>
            </div>

            {/* ── Link + Postback + Button ── */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Destination & Button</p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">Campaign Link <span className="text-red-400">*</span></label>
                <div className="relative">
                  <LinkIcon size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="url"
                    value={formData.link}
                    onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                    placeholder="https://t.me/yourchannel"
                    className={cn(
                      "w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-xl focus:border-[#0c9de8] outline-none text-sm font-medium text-slate-900 transition-all",
                      formData.link && !isValidUrl(formData.link) ? "border-red-300" : "border-slate-200"
                    )}
                  />
                </div>
                {formData.link && !isValidUrl(formData.link) && (
                  <p className="text-[11px] font-bold text-red-500 px-1">Enter a valid URL (https://…)</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">Postback URL <span className="text-slate-300 font-normal">· optional</span></label>
                <div className="relative">
                  <LinkIcon size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="url"
                    value={formData.postback_url}
                    onChange={(e) => setFormData({ ...formData, postback_url: e.target.value })}
                    placeholder="https://yourserver.com/postback?click_id={click_id}"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#0c9de8] outline-none text-sm font-medium text-slate-900 transition-all"
                  />
                </div>
                <p className="text-[10px] text-slate-400 px-1">Must be HTTPS and include <span className="font-mono font-bold">{"{click_id}"}</span> if used.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">Button Text <span className="text-red-400">*</span></label>
                <div className="relative">
                  <Check size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                  <select
                    value={formData.button_text}
                    onChange={(e) => setFormData({ ...formData, button_text: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#0c9de8] outline-none text-sm font-medium text-slate-900 appearance-none cursor-pointer"
                  >
                    <option value="" disabled>Select button label…</option>
                    {BUTTON_TEXTS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdPreview(true)}
              disabled={formData.campaign_title.trim().length < 3 || formData.campaign_title.length > 255 || !formData.message_text.trim() || formData.message_text.length > 1000}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#0c9de8]/30 bg-blue-50 py-3.5 text-xs font-black uppercase tracking-widest text-[#0c9de8] transition-colors hover:border-[#0c9de8]/50 hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Eye size={16} /> Preview Ads
            </button>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3.5 bg-slate-100 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 border border-slate-200"
              >
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={formData.campaign_title.trim().length < 3 || formData.campaign_title.length > 255 || !formData.message_text.trim() || formData.message_text.length > 1000 || !formData.link || !isValidUrl(formData.link) || !formData.button_text || checkRestrictedContent(formData.campaign_title) || checkRestrictedContent(formData.message_text)}
                className="flex-1 py-3.5 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-colors"
                style={{ background: (formData.campaign_title.trim().length < 3 || formData.campaign_title.length > 255 || !formData.message_text.trim() || formData.message_text.length > 1000 || !formData.link || !isValidUrl(formData.link) || !formData.button_text || checkRestrictedContent(formData.campaign_title) || checkRestrictedContent(formData.message_text)) ? undefined : "#0c9de8" }}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Budget & Targeting */}
        {step === 3 && (() => {
          const cpmMin = formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast;
          const cpmMax = formData.type === 'views' ? limits.max_cpm_views : formData.type === 'clicks' ? limits.max_cpm_clicks : limits.max_cpm_broadcast;
          const recCpm = formData.type === 'views' ? limits.recommended_cpm_views : formData.type === 'clicks' ? limits.recommended_cpm_clicks : limits.recommended_cpm_broadcast;
          const bidField = formData.type === "clicks" ? "cpc" : "cpm";
          const bidLabel = formData.type === "clicks" ? "CPC" : "CPM";
          const bidValue = formData.type === "clicks" ? (formData.cpc || formData.cpm) : formData.cpm;
          const cpmVal = parseFloat(bidValue || "0");
          const cpmPct = Math.min(100, Math.max(0, ((cpmVal - cpmMin) / Math.max(0.01, cpmMax - cpmMin)) * 100));
          const recPct = Math.min(100, Math.max(0, ((recCpm - cpmMin) / Math.max(0.01, cpmMax - cpmMin)) * 100));
          const isAboveRec = cpmVal >= recCpm;
          const estimatedReach = Math.floor(parseFloat(formData.budget || "0") / Math.max(0.001, cpmVal) * 1000);
          return (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">

            {/* ── CPM Slider card ── */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <style>{`
                .cpm-range { -webkit-appearance: none; appearance: none; background: transparent; outline: none; }
                .cpm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 34px; height: 34px; border-radius: 50%; background: #0c9de8; border: 4px solid white; box-shadow: 0 2px 12px rgba(12,157,232,0.5), 0 0 0 2px rgba(12,157,232,0.2); cursor: grab; transition: box-shadow 0.15s; }
                .cpm-range:active::-webkit-slider-thumb { cursor: grabbing; box-shadow: 0 4px 20px rgba(12,157,232,0.7), 0 0 0 10px rgba(12,157,232,0.12); }
                .cpm-range::-moz-range-thumb { width: 34px; height: 34px; border-radius: 50%; background: #0c9de8; border: 4px solid white; box-shadow: 0 2px 12px rgba(12,157,232,0.5); cursor: grab; }
                .cpm-range:active::-moz-range-thumb { cursor: grabbing; }
              `}</style>

              {/* CPM value + recommended badge */}
              <div className="px-5 pt-5 pb-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Your Bid ({bidLabel})</p>
                  {isAboveRec ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200">
                      ⭐ Recommended
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200">
                      Below rec.
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-lg font-semibold text-slate-400">$</span>
                  <span className="text-4xl font-bold text-slate-800 tabular-nums leading-none">
                    {parseFloat(bidValue || "0").toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] font-medium text-slate-400 mt-1.5">
                  per 1,000 {formData.type === "clicks" ? "clicks" : "views"}
                </p>
              </div>

              {/* Drag hint */}
              <div className="flex items-center justify-center gap-1.5 pb-2">
                <ChevronLeft size={13} style={{ color: "#0c9de8" }} />
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#0c9de8" }}>
                  Drag to adjust
                </span>
                <ChevronRight size={13} style={{ color: "#0c9de8" }} />
              </div>

              {/* Slider track */}
              <div className="px-6 pb-4 pt-1">
                <div className="relative flex items-center" style={{ height: 52 }}>
                  {/* Track bg */}
                  <div className="absolute inset-x-0 rounded-full" style={{ height: 10, background: "#e2e8f0" }} />
                  {/* Fill */}
                  <div
                    className="absolute left-0 rounded-full pointer-events-none"
                    style={{ height: 10, width: `${cpmPct}%`, background: "linear-gradient(90deg, #0c9de8 0%, #0b7ec9 100%)" }}
                  />
                  {/* Recommended tick mark */}
                  <div
                    className="absolute pointer-events-none"
                    style={{ left: `${recPct}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 3, height: 20, background: '#f59e0b', borderRadius: 2, opacity: 0.8 }}
                  />
                  {/* Range input overlaid */}
                  <input
                    type="range"
                    min={cpmMin}
                    max={cpmMax}
                    step="0.05"
                    value={bidValue}
                    onChange={(e) => setFormData({ ...formData, [bidField]: e.target.value, ...(formData.type === "clicks" ? { cpm: e.target.value } : {}) })}
                    className="cpm-range absolute inset-x-0 w-full"
                    style={{ height: 10 }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Min</p>
                    <p className="text-sm font-black text-slate-600">${cpmMin}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">⭐ Rec.</p>
                    <p className="text-sm font-black text-amber-600">${recCpm.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Max</p>
                    <p className="text-sm font-black text-slate-600">${cpmMax}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Budget card ── */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Exclude {isBotCampaign ? "Bots" : "Channels"} (optional)
              </p>
              <textarea
                value={formData.excluded_inventory}
                onChange={(event) => setFormData((previous) => ({ ...previous, excluded_inventory: event.target.value }))}
                rows={4}
                placeholder={isBotCampaign ? "@example_bot, example_bot, or https://t.me/example_bot" : "@examplechannel, examplechannel, or https://t.me/examplechannel"}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-[#0c9de8]"
              />
              <p className="text-xs font-semibold text-slate-400">One per line or comma-separated. We do not reveal whether an entry is part of our inventory.</p>
            </div>

            {/* ── Budget card ── */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Budget <span className="text-red-400">*</span></p>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  step="1"
                  min={limits.min_budget}
                  value={formData.budget}
                  onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                  placeholder="0.00"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#0c9de8] outline-none text-xl font-black text-slate-900 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400">Minimum budget: <span className="font-black text-slate-600">${limits.min_budget}</span></p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 pt-2">Daily Budget <span className="font-normal normal-case">(optional)</span></p>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  step="1"
                  min="10"
                  value={formData.daily_budget_limit}
                  onChange={(e) => setFormData({ ...formData, daily_budget_limit: e.target.value })}
                  placeholder="No daily cap"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#0c9de8] outline-none text-sm font-bold text-slate-900 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400">If set, minimum $10 and no more than the total budget.</p>
            </div>

            {/* ── Reach estimate ── */}
            <div className="rounded-2xl p-5 flex items-center justify-between gap-4" style={{ background: "linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%)" }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Estimated Reach</p>
                <p className="text-2xl font-black text-white mt-1">
                  {estimatedReach > 0 ? estimatedReach.toLocaleString() : "—"}
                  <span className="text-sm font-bold text-white/70 ml-1.5">{formData.type}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Locked Budget</p>
                <p className="text-xl font-black text-white mt-1">${parseFloat(formData.budget || "0").toFixed(2)}</p>
              </div>
            </div>

            {/* ── Continents ── */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Targeting Regions</p>
              <div className="grid grid-cols-2 gap-2">
                {CONTINENTS.map((con) => (
                  <button
                    key={con.id}
                    onClick={() => toggleContinent(con.id)}
                    className={cn(
                      "px-3 py-3 rounded-xl border text-left transition-all",
                      formData.continents.includes(con.id) ? "border-[#0c9de8]/40 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200",
                      con.id === "global" && "col-span-2"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn("text-xs font-black uppercase tracking-tight", formData.continents.includes(con.id) ? "text-[#0c9de8]" : "text-slate-700")}>
                        {con.name}
                      </span>
                      {formData.continents.includes(con.id) && <Check size={13} className="text-[#0c9de8]" />}
                    </div>
                    <p className="text-[9px] font-medium text-slate-400 mt-0.5">{con.countries}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setStep(2)} className="flex-1 py-3.5 bg-slate-100 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 border border-slate-200">
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading || !formData.budget || !bidValue}
                className="flex-1 py-3.5 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-colors"
                style={{ background: (isLoading || !formData.budget || !bidValue) ? undefined : "#0c9de8" }}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
                {isLoading ? "Creating…" : "Launch Campaign"}
              </button>
            </div>
          </div>
          );
        })()}
      </div>
    </DashboardLayout>
  );
}
