"use client";

import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  PlusCircle,
  Upload,
  Check,
  AlertCircle,
  Loader2,
  Globe,
  Info,
  Type,
  Link as LinkIcon,
  DollarSign,
  Send,
  Trash2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ArrowLeft,
  Bot,
  Eye,
  MousePointer2,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import Modal from "@/components/ui/Modal";
import { CAMPAIGN_CATEGORIES } from "@/lib/campaignCategories";

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
  const isBotCampaign = params.kind === "bot";
  const defaultType = isBotCampaign ? "broadcast" : "views";

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState("");
  const [limits, setLimits] = useState({
    min_cpm_views: 0.5,
    max_cpm_views: 5.0,
    min_cpm_clicks: 2,
    max_cpm_clicks: 20.0,
    min_cpm_broadcast: 1.0,
    max_cpm_broadcast: 10.0,
    min_budget: 10
  });

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    type: defaultType,
    parse_mode: "markdown",
    message_text: "",
    link: "",
    postback_url: "",
    button_text: "",
    budget: "",
    cpm: "",
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
    fetchSettings();
  }, [setTitle]);

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

  const fetchSettings = async () => {
    try {
      const res = await apiFetch("/api/settings");
      const data = await res.json();
      if (res.ok) {
        setLimits({
          min_cpm_views: parseFloat(data.min_cpm_views || "0.5"),
          max_cpm_views: parseFloat(data.max_cpm_views || "5.0"),
          min_cpm_clicks: parseFloat(data.min_cpm_clicks || "2.0"),
          max_cpm_clicks: parseFloat(data.max_cpm_clicks || "20.0"),
          min_cpm_broadcast: parseFloat(data.min_cpm_broadcast || "1.0"),
          max_cpm_broadcast: parseFloat(data.max_cpm_broadcast || "10.0"),
          min_budget: parseFloat(data.min_campaign_budget || "10.0")
        });
        // Set defaults
        setFormData(prev => ({
          ...prev,
          cpm: isBotCampaign ? (data.min_cpm_broadcast || "1.0") : (data.min_cpm_views || "0.5"),
          budget: data.min_campaign_budget || "10.0"
        }));
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  };

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

  const validateMessage = async () => {
    if (!formData.message_text) return;
    setIsValidating(true);
    setError("");
    try {
      const validateData = new FormData();
      validateData.append("text", formData.message_text);
      validateData.append("parse_mode", formData.parse_mode);
      validateData.append("link", formData.link);
      validateData.append("button_text", formData.button_text);
      if (image) {
        validateData.append("image", image);
      }

      const res = await apiFetch("/api/advertiser/campaigns/validate", {
        method: "POST",
        body: validateData,
      });
      const data = await res.json();
      if (res.ok) {
        setIsVerified(true);
      } else {
        setError(data.error);
        setIsVerified(false);
      }
    } catch (err) {
      setError("Failed to connect to validation server");
    } finally {
      setIsValidating(false);
    }
  };

  const checkRestrictedContent = (text: string) => {
    if (formData.type !== "clicks") return false;
    const hasUsername = /@\w+/.test(text);
    const hasLink = /(https?:\/\/[^\s]+)|(\w+\.\w+)/.test(text);
    return hasUsername || hasLink;
  };

  const hasValidCampaignObjective = () => {
    if (isBotCampaign) return formData.type === "broadcast";
    return formData.type === "views" || formData.type === "clicks";
  };

  const selectChannelObjective = (type: "views" | "clicks") => {
    setFormData({
      ...formData,
      type,
      cpm: type === "views" ? limits.min_cpm_views.toString() : limits.min_cpm_clicks.toString(),
    });
    setIsVerified(false);
  };

  const handleSubmit = async () => {
    const trimmedName = (formData.name || "").trim();
    if (trimmedName.length < 3) {
      setError("Campaign name must be at least 3 characters.");
      return;
    }
    if (trimmedName.length > 50) {
      setError("Campaign name must be at most 50 characters.");
      return;
    }

    if (!hasValidCampaignObjective()) {
      setError(isBotCampaign ? "Bot campaign format is required" : "Please select View Campaign or Click Campaign");
      return;
    }
    if (!isVerified) {
      setError("Please validate your message formatting first");
      return;
    }
    if (!formData.category) {
      setError("Please select a campaign category");
      return;
    }
    if (!formData.button_text) {
      setError("Please select a button text");
      return;
    }

    if (checkRestrictedContent(formData.message_text)) {
      setError("Click campaigns cannot contain usernames (@) or links in the message text.");
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
    if (formData.frequency_cap_per_user && (!Number.isInteger(Number(formData.frequency_cap_per_user)) || Number(formData.frequency_cap_per_user) <= 0)) {
      setError("Frequency cap must be a positive whole number.");
      return;
    }
    if (formData.direct_placement_mode === "direct" && formData.direct_inventory_scope === "inventory" && selectedInventoryIds.length === 0) {
      setError("Select at least one inventory item or choose a category, country, or language group.");
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
    submitData.append("direct_inventory_type", isBotCampaign ? "bot" : "channel");
    submitData.append("direct_inventory_ids", JSON.stringify(selectedInventoryIds));

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
    } catch (err) {
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

  return (
    <DashboardLayout type="advertiser">
      <div className="max-w-3xl mx-auto space-y-8 pb-12">
        <Link
          href="/advertiser/campaigns/new"
          className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to campaign types
        </Link>

        {/* Progress Bar */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all duration-500",
                step >= s ? "bg-blue-600" : "bg-slate-100"
              )}
            />
          ))}
        </div>

        <Modal
          isOpen={!!error}
          onClose={() => setError("")}
          type="error"
          title="Validation Error"
        >
          {error}
        </Modal>

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                {isBotCampaign ? "Bot Campaign Details" : "Channel Campaign Details"}
              </h2>
              <p className="text-slate-500 text-sm">Tell us about your campaign basics.</p>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Campaign Name</label>
                <div className="relative">
                  <Type size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Summer Crypto Promotion"
                    maxLength={50}
                    className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-bold text-slate-900 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Category</label>
                  <div className="relative" ref={categoryDropdownRef}>
                    <Globe size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" />
                    <button
                      type="button"
                      onClick={() => setCategoryDropdownOpen((prev) => !prev)}
                      className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-bold text-slate-900 cursor-pointer flex items-center justify-between text-left"
                    >
                      <span className={cn(!formData.category && "text-slate-400")}>
                        {formData.category || "Select category"}
                      </span>
                      <ChevronDown size={18} className={cn("text-slate-400 transition-transform shrink-0", categoryDropdownOpen && "rotate-180")} />
                    </button>

                    {categoryDropdownOpen && (
                      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
                        {CAMPAIGN_CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, category: cat });
                              setCategoryDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full px-4 py-3 text-left text-sm font-bold transition-colors hover:bg-slate-50",
                              formData.category === cat ? "bg-blue-50 text-blue-600" : "text-slate-700"
                            )}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {isBotCampaign ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <Bot size={20} className="text-emerald-600 shrink-0" />
                    <p className="text-xs font-bold text-emerald-700 leading-relaxed">
                      Broadcast format — your post will be sent directly to bot subscribers.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Campaign Objective</label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => selectChannelObjective("views")}
                        className={cn(
                          "flex min-h-28 items-start gap-3 rounded-2xl border bg-white p-4 text-left transition-all",
                          formData.type === "views" ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-100 hover:border-slate-200"
                        )}
                      >
                        <span className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          formData.type === "views" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                        )}>
                          <Eye size={20} />
                        </span>
                        <span className="space-y-1">
                          <span className="block text-sm font-black uppercase tracking-tight text-slate-900">View Campaign</span>
                          <span className="block text-xs font-semibold leading-relaxed text-slate-500">Pay for channel post views.</span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => selectChannelObjective("clicks")}
                        className={cn(
                          "flex min-h-28 items-start gap-3 rounded-2xl border bg-white p-4 text-left transition-all",
                          formData.type === "clicks" ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-100 hover:border-slate-200"
                        )}
                      >
                        <span className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          formData.type === "clicks" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                        )}>
                          <MousePointer2 size={20} />
                        </span>
                        <span className="space-y-1">
                          <span className="block text-sm font-black uppercase tracking-tight text-slate-900">Click Campaign</span>
                          <span className="block text-xs font-semibold leading-relaxed text-slate-500">Pay for button/link clicks.</span>
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex gap-3 text-blue-700">
                <Info size={20} className="shrink-0" />
                <p className="text-xs font-bold leading-relaxed">
                  {formData.type === 'views'
                    ? "Select VIEWS if you want broad reach and brand recognition across channels."
                    : formData.type === 'clicks'
                    ? "Select CLICKS if you want direct conversions and user engagement."
                    : "Your post will be sent to bot users. Perfect if you are targeting bot users specifically."}
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                if (!hasValidCampaignObjective()) {
                  setError(isBotCampaign ? "Bot campaign format is required" : "Please select View Campaign or Click Campaign");
                  return;
                }
                setStep(2);
              }}
              disabled={!formData.name || !hasValidCampaignObjective()}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-all active:scale-[0.98]"
            >
              Next Step <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* Step 2: Content */}
        {step === 2 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Ad Content</h2>
              <p className="text-slate-500 text-sm">Design your message and upload an image.</p>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Message Text</label>
                  <span className="text-[10px] font-bold text-slate-400">{formData.message_text.length}/1000</span>
                </div>
                <textarea
                  value={formData.message_text}
                  onChange={(e) => {
                    setFormData({ ...formData, message_text: e.target.value.slice(0, 1000) });
                    setIsVerified(false);
                  }}
                  rows={6}
                  placeholder="Your advertisement message here..."
                  className={cn(
                    "w-full px-6 py-4 bg-white border rounded-2xl focus:border-blue-500 outline-none font-bold text-slate-900 transition-all resize-none",
                    checkRestrictedContent(formData.message_text) ? "border-red-500 bg-red-50/10" : "border-slate-200"
                  )}
                />
                {checkRestrictedContent(formData.message_text) && (
                  <div className="flex items-center gap-1.5 text-red-500 mt-1 animate-pulse">
                    <AlertCircle size={14} />
                    <span className="text-[10px] font-black uppercase tracking-tight">Click campaigns cannot contain @usernames or links</span>
                  </div>
                )}
                <div className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Select parse mode</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setFormData({ ...formData, parse_mode: 'markdown' }); setIsVerified(false); }}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-none",
                        formData.parse_mode === 'markdown' ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-100 text-slate-400"
                      )}
                    >
                      Markdown
                    </button>
                    <button
                      onClick={() => { setFormData({ ...formData, parse_mode: 'html' }); setIsVerified(false); }}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-none",
                        formData.parse_mode === 'html' ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-100 text-slate-400"
                      )}
                    >
                      HTML
                    </button>
                    <button
                      onClick={() => { setFormData({ ...formData, parse_mode: 'none' }); setIsVerified(false); }}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-none",
                        formData.parse_mode === 'none' ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-100 text-slate-400"
                      )}
                    >
                      None
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={validateMessage}
                      disabled={!formData.message_text || isValidating || isVerified}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-none",
                        isVerified ? "bg-emerald-50 text-emerald-600" : "bg-blue-600 text-white disabled:bg-slate-100 disabled:text-slate-400"
                      )}
                    >
                      {isValidating ? <Loader2 size={14} className="animate-spin" /> : (isVerified ? <Check size={14} /> : <Send size={14} />)}
                      {isVerified ? "Validated" : "Validate"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Ad Image (Optional)</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "relative border-2 border-dashed rounded-2xl h-48 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer group",
                    imagePreview ? "border-blue-200 bg-blue-50/10" : "border-slate-100 hover:border-blue-200 hover:bg-slate-50"
                  )}
                >
                  {imagePreview ? (
                    <>
                      <img src={imagePreview} alt="Preview" className="h-full w-full object-contain p-2 rounded-2xl" />
                      <button
                        onClick={(e) => { e.stopPropagation(); setImage(null); setImagePreview(null); }}
                        className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-sm text-red-600 rounded-xl hover:bg-white transition-all shadow-sm"
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-slate-300 group-hover:text-blue-500 shadow-sm transition-colors">
                        <Upload size={24} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Click to upload</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Max 1MB • PNG/JPG</p>
                      </div>
                    </>
                  )}
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Campaign Link</label>
                  <div className="relative">
                    <LinkIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={formData.link}
                      onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                      placeholder="https://t.me/yourchannel"
                      className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-bold text-slate-900 transition-all text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Postback URL</label>
                  <div className="relative">
                    <LinkIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={formData.postback_url}
                      onChange={(e) => setFormData({ ...formData, postback_url: e.target.value })}
                      placeholder="https://advertiser.com/postback?click_id={click_id}"
                      className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-bold text-slate-900 transition-all text-sm"
                    />
                  </div>
                  <p className="text-[10px] font-bold text-slate-400">Optional. Must be HTTPS and include {"{click_id}"}.</p>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Button Text</label>
                  <div className="relative">
                    <Check size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" />
                    <select
                      value={formData.button_text}
                      onChange={(e) => setFormData({ ...formData, button_text: e.target.value })}
                      className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-bold text-slate-900 appearance-none cursor-pointer"
                    >
                      <option value="" disabled>Select button text</option>
                      {BUTTON_TEXTS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 bg-slate-100 text-slate-900 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-none border border-slate-200"
              >
                <ChevronLeft size={16} />
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!formData.message_text || !formData.link || !isValidUrl(formData.link) || !formData.button_text || !isVerified || checkRestrictedContent(formData.message_text)}
                className="flex-1 py-3 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-none"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Budget & Targeting */}
        {step === 3 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Budget & Reach</h2>
              <p className="text-slate-500 text-sm">Set your CPM and total campaign budget.</p>
            </div>

            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">
                    CPM ($ / 1000 {formData.type})
                  </label>
                  <div className="relative">
                    <DollarSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-900 font-bold" />
                    <input
                      type="number"
                      step="0.01"
                      value={formData.cpm}
                      onChange={(e) => setFormData({ ...formData, cpm: e.target.value })}
                      className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-black text-slate-900 transition-all text-xl"
                    />
                  </div>
                  <div className="pt-2 px-1">
                    <input
                      type="range"
                      min={formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast}
                      max={formData.type === 'views' ? limits.max_cpm_views : formData.type === 'clicks' ? limits.max_cpm_clicks : limits.max_cpm_broadcast}
                      step="0.05"
                      value={formData.cpm}
                      onChange={(e) => setFormData({ ...formData, cpm: e.target.value })}
                      className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      style={{
                        background: `linear-gradient(to right, #10b981 0%, #10b981 ${((parseFloat(formData.cpm || "0") - (formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast)) / ((formData.type === 'views' ? limits.max_cpm_views : formData.type === 'clicks' ? limits.max_cpm_clicks : limits.max_cpm_broadcast) - (formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast))) * 100}%, #f1f5f9 ${((parseFloat(formData.cpm || "0") - (formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast)) / ((formData.type === 'views' ? limits.max_cpm_views : formData.type === 'clicks' ? limits.max_cpm_clicks : limits.max_cpm_broadcast) - (formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast))) * 100}%, #f1f5f9 100%)`
                      }}
                    />
                    <div className="flex justify-between mt-1.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Min: ${formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Max: ${formData.type === 'views' ? limits.max_cpm_views : formData.type === 'clicks' ? limits.max_cpm_clicks : limits.max_cpm_broadcast}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400">Total Budget ($)</label>
                  <div className="relative">
                    <DollarSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-900 font-bold" />
                    <input
                      type="number"
                      step="1"
                      value={formData.budget}
                      onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                      className="w-full pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-black text-slate-900 transition-all text-xl"
                    />
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Min Budget: ${limits.min_budget}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Targeting Continents</label>
                <div className="grid grid-cols-2 gap-3">
                  {CONTINENTS.map((con) => (
                    <button
                      key={con.id}
                      onClick={() => toggleContinent(con.id)}
                      className={cn(
                        "p-4 rounded-2xl border transition-all text-left space-y-1",
                        formData.continents.includes(con.id) ? "bg-blue-50 border-blue-200" : "bg-white border-slate-100",
                        con.id === "global" && "col-span-2"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn("text-xs font-black uppercase tracking-tight", formData.continents.includes(con.id) ? "text-blue-600" : "text-slate-900")}>
                          {con.name}
                        </span>
                        {formData.continents.includes(con.id) && <Check size={14} className="text-blue-600" />}
                      </div>
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{con.countries}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setTargetingOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-xs font-black uppercase tracking-widest text-slate-400">Advanced Targeting</span>
                    <span className="block text-sm font-bold text-slate-900">All audiences by default</span>
                  </span>
                  <ChevronDown size={18} className={cn("text-slate-400 transition-transform", targetingOpen && "rotate-180")} />
                </button>

                {targetingOpen && (
                  <div className="grid gap-4 border-t border-slate-100 p-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Countries</label>
                      <input
                        type="text"
                        value={formData.countries}
                        onChange={(e) => setFormData({ ...formData, countries: e.target.value })}
                        placeholder="All countries"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      />
                      <p className="text-[10px] font-bold text-slate-400">Optional comma-separated ISO codes, e.g. US, NG, GB.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Languages</label>
                      <input
                        type="text"
                        value={formData.languages}
                        onChange={(e) => setFormData({ ...formData, languages: e.target.value })}
                        placeholder="All languages"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      />
                      <p className="text-[10px] font-bold text-slate-400">Optional comma-separated language codes, e.g. en, fr, es.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">VPN / Proxy Traffic</label>
                      <select
                        value={formData.vpn_policy}
                        onChange={(e) => setFormData({ ...formData, vpn_policy: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      >
                        <option value="allow_all">Allow all traffic</option>
                        <option value="prefer_non_vpn">Prefer non-VPN traffic</option>
                        <option value="exclude_vpn">Exclude VPN/proxy traffic</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Device Type</label>
                      <select
                        value={formData.device_policy}
                        onChange={(e) => setFormData({ ...formData, device_policy: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      >
                        <option value="all">All devices</option>
                        <option value="mobile">Mobile only</option>
                        <option value="desktop">Desktop only</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Platform / OS</label>
                      <select
                        value={formData.os_policy}
                        onChange={(e) => setFormData({ ...formData, os_policy: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      >
                        <option value="all">All platforms</option>
                        <option value="android">Android</option>
                        <option value="ios">iOS</option>
                        <option value="desktop_web">Desktop/Web</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Frequency Cap</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={formData.frequency_cap_per_user}
                        onChange={(e) => setFormData({ ...formData, frequency_cap_per_user: e.target.value })}
                        placeholder={formData.type === "clicks" ? "Max clicks per user per day" : "Max impressions per user per day"}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Start Date</label>
                      <input
                        type="datetime-local"
                        value={formData.start_at}
                        onChange={(e) => setFormData({ ...formData, start_at: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">End Date</label>
                      <input
                        type="datetime-local"
                        value={formData.end_at}
                        onChange={(e) => setFormData({ ...formData, end_at: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Daily Budget Limit</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.daily_budget_limit}
                        onChange={(e) => setFormData({ ...formData, daily_budget_limit: e.target.value })}
                        placeholder="No daily cap"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Store size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Placement Buying</p>
                    <h3 className="text-sm font-black text-slate-900">Run across network or select inventory</h3>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, direct_placement_mode: "network", direct_inventory_scope: "network" }));
                      setSelectedInventoryIds([]);
                    }}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-all",
                      formData.direct_placement_mode === "network" ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50"
                    )}
                  >
                    <p className="text-sm font-black text-slate-900">Run Across Network</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Use all eligible inventory.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, direct_placement_mode: "direct", direct_inventory_scope: "inventory" }))}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-all",
                      formData.direct_placement_mode === "direct" ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50"
                    )}
                  >
                    <p className="text-sm font-black text-slate-900">Select Specific Inventory</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Choose one, multiple, or group targets.</p>
                  </button>
                </div>

                {formData.direct_placement_mode === "direct" && (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, direct_inventory_scope: "category" }))}
                        className={cn("rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-widest", formData.direct_inventory_scope === "category" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500")}
                      >
                        Entire Category
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, direct_inventory_scope: "country" }))}
                        className={cn("rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-widest", formData.direct_inventory_scope === "country" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500")}
                      >
                        Entire Country
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, direct_inventory_scope: "language" }))}
                        className={cn("rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-widest", formData.direct_inventory_scope === "language" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500")}
                      >
                        Language Group
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <input
                        value={formData.direct_categories}
                        onChange={(event) => setFormData((prev) => ({ ...prev, direct_categories: event.target.value, direct_inventory_scope: "category" }))}
                        placeholder="Categories, comma-separated"
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                      />
                      <input
                        value={formData.direct_countries}
                        onChange={(event) => setFormData((prev) => ({ ...prev, direct_countries: event.target.value, direct_inventory_scope: "country" }))}
                        placeholder="Countries, e.g. US, NG"
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                      />
                      <input
                        value={formData.direct_languages}
                        onChange={(event) => setFormData((prev) => ({ ...prev, direct_languages: event.target.value, direct_inventory_scope: "language" }))}
                        placeholder="Languages, e.g. en, fr"
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Recommended {isBotCampaign ? "Bots" : "Channels"}
                        </p>
                        <Link href={`/advertiser/marketplace?type=${isBotCampaign ? "bot" : "channel"}`} className="text-[10px] font-black uppercase tracking-widest text-blue-600">
                          Browse Marketplace
                        </Link>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {recommendedInventory.length === 0 ? (
                          <div className="rounded-xl bg-slate-50 p-4 text-xs font-semibold text-slate-400 sm:col-span-3">No recommendations yet. Try category, country, or language targeting.</div>
                        ) : recommendedInventory.map((item) => {
                          const selected = selectedInventoryIds.includes(item.id);
                          return (
                            <button
                              type="button"
                              key={`${item.type}-${item.id}`}
                              onClick={() => toggleInventory(item.id)}
                              className={cn("rounded-xl border p-3 text-left transition-all", selected ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50")}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-black text-slate-900">{item.name}</p>
                                {selected && <Check size={14} className="text-blue-600" />}
                              </div>
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">@{item.username || "private"}</p>
                              <p className="mt-2 text-[10px] font-bold text-slate-500">
                                {Number(item.monthly_impressions || 0).toLocaleString()} reach / {item.traffic_quality_rating}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary Box */}
              <div className="p-6 bg-slate-900 rounded-3xl text-white space-y-4">
                <div className="flex justify-between items-end border-b border-white/10 pb-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Estimated Reach</p>
                  <p className="text-xl font-black text-emerald-400">
                    {(parseFloat(formData.budget || "0") / parseFloat(formData.cpm || "1") * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} {formData.type}
                  </p>
                </div>
                <div className="flex justify-between items-end pt-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Total Locked Funds</p>
                  <p className="text-xl font-black text-white">${parseFloat(formData.budget || "0").toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 bg-slate-100 text-slate-900 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-none border border-slate-200"
              >
                <ChevronLeft size={16} />
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading || !formData.budget || !formData.cpm}
                className="flex-1 py-3 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-none"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
                {isLoading ? "Creating..." : "Launch"}
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
