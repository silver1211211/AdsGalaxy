"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check, CheckCircle2, Loader2, Smartphone, ChevronLeft,
  Globe, Shield, Monitor, Calendar, DollarSign,
  AlertCircle, Search, Image as ImageIcon, Type,
  Zap, Target, Wifi, WifiOff, X, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "General", "Utilities", "Education", "AI", "Gaming",
  "Finance", "Crypto", "Trading", "Shopping", "Entertainment", "Other",
];

const COUNTRIES = [
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "PK", name: "Pakistan", flag: "🇵🇰" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "GH", name: "Ghana", flag: "🇬🇭" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "AE", name: "UAE", flag: "🇦🇪" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "IR", name: "Iran", flag: "🇮🇷" },
  { code: "IQ", name: "Iraq", flag: "🇮🇶" },
  { code: "MA", name: "Morocco", flag: "🇲🇦" },
  { code: "DZ", name: "Algeria", flag: "🇩🇿" },
  { code: "TN", name: "Tunisia", flag: "🇹🇳" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿" },
  { code: "UG", name: "Uganda", flag: "🇺🇬" },
  { code: "SN", name: "Senegal", flag: "🇸🇳" },
  { code: "CM", name: "Cameroon", flag: "🇨🇲" },
];

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "ar", name: "Arabic" },
  { code: "pt", name: "Portuguese" },
  { code: "de", name: "German" },
  { code: "id", name: "Indonesian" },
];

const VPN_OPTIONS = [
  { value: "allow_all",     label: "Allow All",      sub: "VPN and direct traffic",     icon: Wifi },
  { value: "prefer_non_vpn",label: "Prefer Direct",  sub: "Prioritize non-VPN users",   icon: Shield },
  { value: "exclude_vpn",   label: "No VPN",         sub: "Block VPN/proxy traffic",    icon: WifiOff },
];

const DEVICE_OPTIONS = [
  { value: "all",     label: "All Devices", icon: Globe },
  { value: "mobile",  label: "Mobile",      icon: Smartphone },
  { value: "desktop", label: "Desktop",     icon: Monitor },
];

const OS_OPTIONS = [
  { value: "all",         label: "All OS" },
  { value: "android",     label: "Android" },
  { value: "ios",         label: "iOS" },
  { value: "desktop_web", label: "Desktop/Web" },
];

const STEPS = ["Ad Creative", "Targeting", "Budget & Launch"];

const emptyForm = {
  campaign_name: "",
  excluded_inventory: "",
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
  vpn_policy: "allow_all",
  device_policy: "all",
  os_policy: "all",
  start_at: "",
  end_at: "",
  daily_budget_limit: "",
  frequency_cap_per_user: "",
};

// ── Step bar ───────────────────────────────────────────────────────────────────

function StepBar({ step }: { step: number }) {
  return (
    <div className="mb-6 flex items-center gap-0">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = step > idx;
        const active = step === idx;
        return (
          <React.Fragment key={label}>
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
            {i < STEPS.length - 1 && (
              <div
                className="flex-1 h-0.5 mb-5 mx-1.5"
                style={{ background: step > idx ? "#0c9de8" : "#e2e8f0" }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Field component ────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = "text", required = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 outline-none focus:border-[#0c9de8] focus:bg-white transition-all placeholder:font-normal placeholder:text-slate-400"
      />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdvertiserMiniAppRewardedPage() {
  const { setTitle } = useHeader();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditMode = !!editId;
  const [form, setForm] = useState(emptyForm);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recommendedCpm, setRecommendedCpm] = useState(1.0);
  const [cpmPercent, setCpmPercent] = useState(50);

  const cpmMin = 0.1;
  const cpmMax = 20;

  const filteredCountries = useMemo(() =>
    COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
    ), [countrySearch]);

  useEffect(() => {
    setTitle(isEditMode ? "Edit Mini App Ad" : "Mini App Campaign");
    apiFetch("/api/settings").then(r => r.json()).then(d => {
      const rec = parseFloat(d?.miniapp_internal_recommended_cpm || "1.00");
      setRecommendedCpm(rec);
      if (!isEditMode) {
        setForm(prev => ({ ...prev, advertiser_cpm_bid: rec.toFixed(2) }));
        setCpmPercent(Math.round(((rec - cpmMin) / (cpmMax - cpmMin)) * 100));
      }
    }).catch(() => {});
  }, [setTitle, isEditMode]);

  useEffect(() => {
    if (!editId) return;
    apiFetch(`/api/advertiser/miniapp-rewarded-campaigns/${editId}`)
      .then(r => r.json())
      .then((c: any) => {
        if (c.error) return;
        const parseList = (value: unknown) => {
          if (Array.isArray(value)) return value.map(String).filter(Boolean);
          try {
            const parsed = JSON.parse(String(value || "[]"));
            if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
          } catch { /* legacy comma-separated value */ }
          return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
        };
        setForm({
          ...emptyForm,
          campaign_name: c.campaign_name || "",
          excluded_inventory: Array.isArray(c.excluded_inventory) ? c.excluded_inventory.join("\n") : "",
          title: c.title || "",
          description: c.description || "",
          image_url: c.image_url || "",
          landing_url: c.landing_url || "",
          cta_text: c.cta_text || "Learn More",
          title_color: c.title_color || "",
          body_color: c.body_color || "",
          postback_url: c.postback_url || "",
          categories: parseList(c.categories),
          budget: c.budget ? String(parseFloat(c.budget)) : "",
          advertiser_cpm_bid: c.advertiser_cpm_bid ? String(parseFloat(c.advertiser_cpm_bid)) : "",
          campaign_budget_mode: c.campaign_budget_mode === "unlimited" || Number(c.budget || 0) === 0 ? "unlimited" : "custom",
          daily_budget_mode: c.daily_budget_mode || "custom",
          vpn_policy: c.vpn_policy || "allow_all",
          device_policy: c.device_policy || "all",
          os_policy: c.os_policy || "all",
          start_at: c.start_at ? String(c.start_at).slice(0, 16) : "",
          end_at: c.end_at ? String(c.end_at).slice(0, 16) : "",
          daily_budget_limit: c.daily_budget_limit ? String(c.daily_budget_limit) : "",
          frequency_cap_per_user: c.frequency_cap_per_user ? String(c.frequency_cap_per_user) : "",
        });
        setSelectedCountries(parseList(c.countries));
        setSelectedLanguages(parseList(c.languages));
        if (c.image_url) setImagePreview(c.image_url);
        const cpm = parseFloat(c.advertiser_cpm_bid || "1.0");
        if (!isNaN(cpm)) setCpmPercent(Math.min(100, Math.max(0, Math.round(((cpm - cpmMin) / (cpmMax - cpmMin)) * 100))));
      })
      .catch(() => {});
  }, [editId]);

  const handleCpmSlider = (val: number) => {
    setCpmPercent(val);
    const cpm = (cpmMin + (val / 100) * (cpmMax - cpmMin)).toFixed(2);
    setForm(prev => ({ ...prev, advertiser_cpm_bid: cpm }));
  };

  const handleCpmInput = (val: string) => {
    setForm(prev => ({ ...prev, advertiser_cpm_bid: val }));
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setCpmPercent(Math.min(100, Math.max(0, Math.round(((num - cpmMin) / (cpmMax - cpmMin)) * 100))));
    }
  };

  const toggleCountry = (code: string) => {
    setSelectedCountries(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const toggleLanguage = (code: string) => {
    setSelectedLanguages(prev =>
      prev.includes(code) ? prev.filter(l => l !== code) : [...prev, code]
    );
  };

  const toggleCategory = (cat: string) => {
    setForm(prev => {
      const cats = Array.isArray(prev.categories) ? prev.categories : [];
      return {
        ...prev,
        categories: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat],
      };
    });
  };

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setImageError("This file is not an image. Please choose a JPG, PNG, or similar image file.");
      return;
    }

    // Show preview immediately so the user sees we detected their file
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    setImageFile(file);
    setImageError("");
    setForm(p => ({ ...p, image_url: "" }));

    // Size check
    if (file.size > 1 * 1024 * 1024) {
      setImageError("Image is too large. Maximum allowed size is 1 MB.");
      return;
    }

    // Dimension + square check
    const dimensionError = await new Promise<string>((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img;
        if (w !== h) { resolve(`Image must be square (1:1). Yours is ${w}×${h}px.`); return; }
        if (w < 240 || w > 1024) { resolve(`Dimensions must be 240–1024px. Yours is ${w}×${h}px.`); return; }
        resolve("");
      };
      img.onerror = () => resolve("Could not read image dimensions.");
      img.src = previewUrl;
    });

    if (dimensionError) {
      setImageError(dimensionError);
      return;
    }

    // All checks passed — upload
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await apiFetch("/api/advertiser/upload-image", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setForm(p => ({ ...p, image_url: data.url }));
      setImageError("");
    } catch (e: any) {
      setImageError(e.message);
      setForm(p => ({ ...p, image_url: "" }));
    } finally {
      setImageUploading(false);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageError("");
    setForm(p => ({ ...p, image_url: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isValidLandingUrl = form.landing_url.trim().length > 0 && /^https?:\/\/.+\..+/.test(form.landing_url.trim());
  const step1Valid = form.campaign_name.trim().length >= 3 && form.title.trim().length >= 3 && form.description.trim().length > 0 && isValidLandingUrl && !!form.image_url && !imageUploading && !imageError;
  const step3Valid = Number(form.advertiser_cpm_bid) > 0 &&
    (form.campaign_budget_mode === "unlimited" || Number(form.budget) > 0);

  const recPct = Math.min(100, Math.max(0, ((recommendedCpm - cpmMin) / (cpmMax - cpmMin)) * 100));

  const submit = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (!step3Valid) throw new Error("Please set a valid CPM bid and budget.");
      if (form.start_at && form.end_at && new Date(form.start_at) >= new Date(form.end_at)) {
        throw new Error("Start date must be before end date.");
      }
      const payload = {
        ...form,
        countries: selectedCountries.join(","),
        languages: selectedLanguages.join(","),
      };

      if (isEditMode) {
        const res = await apiFetch(`/api/advertiser/miniapp-rewarded-campaigns/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update campaign");
        router.push("/advertiser/campaigns");
      } else {
        const res = await apiFetch("/api/advertiser/miniapp-rewarded-campaigns", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            direct_placement_mode: "network",
            direct_inventory_scope: "network",
            direct_inventory_type: "miniapp",
            direct_inventory_ids: [],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create campaign");
        setForm(emptyForm);
        setSelectedCountries([]);
        setSelectedLanguages([]);
        setCpmPercent(50);
        setImageFile(null);
        setImagePreview("");
        setImageError("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        setStep(1);
        router.push("/advertiser/campaigns");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout type="advertiser">
      <style>{`
        .shiny-btn { background: linear-gradient(135deg,#0c9de8 0%,#0b7ec9 100%); box-shadow: 0 4px 16px rgba(12,157,232,.32); transition: background .2s, box-shadow .2s, transform .15s; }
        .shiny-btn:hover { background: linear-gradient(135deg,#3dbfff 0%,#0c9de8 100%); box-shadow: 0 6px 24px rgba(12,157,232,.52); transform: translateY(-1px); }
        .shiny-btn:active { transform: translateY(0); }
        .miniapp-cpm::-webkit-slider-thumb { -webkit-appearance:none; width:30px; height:30px; border-radius:50%; background:#0c9de8; border:4px solid white; box-shadow:0 2px 10px rgba(12,157,232,.45); cursor:grab; }
        .miniapp-cpm:active::-webkit-slider-thumb { cursor:grabbing; box-shadow:0 4px 18px rgba(12,157,232,.65); }
        .miniapp-cpm::-moz-range-thumb { width:30px; height:30px; border-radius:50%; background:#0c9de8; border:4px solid white; box-shadow:0 2px 10px rgba(12,157,232,.45); cursor:grab; }
        .miniapp-cpm { -webkit-appearance:none; appearance:none; background:transparent; outline:none; }
      `}</style>

      <div className="space-y-6 pb-10">

        {/* ── Wizard card ── */}
        <div className="rounded-[2rem] border border-blue-100 bg-white shadow-xl shadow-blue-100/50 p-5">

          {/* Header */}
          <div className="relative mb-5 overflow-hidden rounded-[1.7rem] bg-slate-950 p-5 text-white">
            <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[#0c9de8]/30 blur-3xl" />
            <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-blue-100">
              <Smartphone size={20} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-blue-100/70">Mini App Campaign</p>
              <p className="text-base font-black text-white">Step {step} of {STEPS.length} — {STEPS[step - 1]}</p>
              <p className="mt-1 text-[11px] font-semibold text-blue-100/70">Rewarded ad setup with the same campaign logic.</p>
            </div>
            </div>
          </div>

          <StepBar step={step} />

          {/* ── STEP 1: Ad Creative ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-4">
                {/* Campaign Name */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Campaign Name <span className="text-red-400">*</span>
                    </label>
                    <span className={cn(
                      "text-[10px] font-bold",
                      form.campaign_name.length > 0 && form.campaign_name.trim().length < 3 ? "text-red-400" : "text-slate-300"
                    )}>
                      {form.campaign_name.length}/50
                    </span>
                  </div>
                  <div className="relative">
                    <Type size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      value={form.campaign_name}
                      onChange={e => setForm(p => ({ ...p, campaign_name: e.target.value }))}
                      placeholder="e.g. Summer Crypto Promo"
                      maxLength={50}
                      className={cn(
                        "w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-2xl outline-none text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400",
                        form.campaign_name.length > 0 && form.campaign_name.trim().length < 3
                          ? "border-red-300 focus:border-red-400"
                          : "border-slate-200 focus:border-[#0c9de8] focus:bg-white"
                      )}
                    />
                  </div>
                  {form.campaign_name.length > 0 && form.campaign_name.trim().length < 3 && (
                    <p className="text-[11px] font-bold text-red-500 flex items-center gap-1">
                      <AlertCircle size={11} /> Minimum 3 characters required
                    </p>
                  )}
                </div>

                {/* Ad Title */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Ad Title <span className="text-red-400">*</span>
                    </label>
                    <span className={cn(
                      "text-[10px] font-bold",
                      form.title.length > 0 && form.title.trim().length < 3 ? "text-red-400" : "text-slate-300"
                    )}>
                      {form.title.length}/80
                    </span>
                  </div>
                  <div className="relative">
                    <Type size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      value={form.title}
                      onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      placeholder="Short attention-grabbing headline"
                      maxLength={80}
                      className={cn(
                        "w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-2xl outline-none text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400",
                        form.title.length > 0 && form.title.trim().length < 3
                          ? "border-red-300 focus:border-red-400"
                          : "border-slate-200 focus:border-[#0c9de8] focus:bg-white"
                      )}
                    />
                  </div>
                  {form.title.length > 0 && form.title.trim().length < 3 && (
                    <p className="text-[11px] font-bold text-red-500 flex items-center gap-1">
                      <AlertCircle size={11} /> Minimum 3 characters required
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description <span className="text-red-400">*</span></label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Describe what this ad is about"
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 outline-none focus:border-[#0c9de8] focus:bg-white transition-all placeholder:font-normal placeholder:text-slate-400 resize-none"
                  />
                </div>
                {/* Image Upload */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Ad Image <span className="text-red-400">*</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
                  />
                  {imagePreview ? (
                    <div className="space-y-2">
                      <div className={cn(
                        "relative rounded-2xl overflow-hidden border",
                        imageError ? "border-red-300" : "border-slate-200"
                      )}>
                        <img src={imagePreview} alt="Ad preview" className="w-full h-44 object-cover" />
                        {imageUploading && (
                          <div className="absolute inset-0 bg-white/60 flex items-center justify-center gap-2">
                            <Loader2 size={20} className="animate-spin text-[#0c9de8]" />
                            <span className="text-xs font-black text-[#0c9de8]">Uploading…</span>
                          </div>
                        )}
                        {imageError && (
                          <div className="absolute inset-0 bg-red-900/40 flex items-end p-3">
                            <div className="w-full flex items-start gap-2 rounded-xl bg-red-600 px-3 py-2.5">
                              <AlertCircle size={14} className="text-white shrink-0 mt-0.5" />
                              <p className="text-xs font-bold text-white leading-snug">{imageError}</p>
                            </div>
                          </div>
                        )}
                        {form.image_url && !imageUploading && !imageError && (
                          <div className="absolute bottom-2 right-2 bg-emerald-500 text-white rounded-full p-1">
                            <Check size={12} />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={clearImage}
                          className="absolute top-2 right-2 z-10 bg-white/90 backdrop-blur rounded-full p-1.5 text-slate-600 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {imageError && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full py-2 rounded-xl border border-red-200 bg-red-50 text-[11px] font-black text-red-600 hover:bg-red-100 transition-colors"
                        >
                          Choose a different image
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-3 py-8 rounded-2xl border-2 border-dashed border-slate-200 hover:border-[#0c9de8] bg-slate-50 hover:bg-blue-50 transition-all"
                    >
                      <ImageIcon size={28} className="text-slate-300" />
                      <div className="text-center">
                        <p className="text-xs font-black text-slate-600">Tap to choose image</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-0.5">Any image format · max 1 MB</p>
                      </div>
                    </button>
                  )}
                  <div className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2.5">
                    <AlertCircle size={13} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] font-semibold text-blue-700 leading-relaxed">
                      Image must be <span className="font-black">square (1:1)</span>. Max file size: <span className="font-black">1 MB</span>. Supported dimensions: <span className="font-black">240px – 1024px</span>.
                    </p>
                  </div>
                </div>
                {/* Landing URL */}
                {(() => {
                  const isInvalidUrl = form.landing_url.trim().length > 0 && !isValidLandingUrl;
                  return (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Landing URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="url"
                        value={form.landing_url}
                        onChange={e => setForm(p => ({ ...p, landing_url: e.target.value }))}
                        placeholder="https://t.me/YourBot/app"
                        className={cn(
                          "w-full px-4 py-3 bg-slate-50 border rounded-2xl outline-none text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400",
                          isInvalidUrl
                            ? "border-red-300 focus:border-red-400"
                            : "border-slate-200 focus:border-[#0c9de8] focus:bg-white"
                        )}
                      />
                      {isInvalidUrl && (
                        <p className="text-[11px] font-bold text-red-500 px-1">Enter a valid URL (https://…)</p>
                      )}
                    </div>
                  );
                })()}
                <Field label="CTA Button Text" value={form.cta_text} onChange={v => setForm(p => ({ ...p, cta_text: v }))} placeholder="Learn More" />
                <Field label="Postback URL (optional)" value={form.postback_url} onChange={v => setForm(p => ({ ...p, postback_url: v }))} placeholder="https://tracker.example.com/postback?click_id={click_id}" />
              </div>

              {/* Categories */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ad Categories <span className="text-slate-300 font-normal">(optional)</span></label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(cat => {
                    const active = Array.isArray(form.categories) && form.categories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={cn(
                          "px-3 py-2 rounded-xl text-[11px] font-black border transition-all",
                          active ? "bg-[#0c9de8] border-[#0c9de8] text-white" : "bg-slate-50 border-slate-200 text-slate-500 hover:border-[#0c9de8]"
                        )}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] font-semibold text-slate-400">Leave empty to show across all categories.</p>
              </div>
            </div>
          )}

          {/* ── STEP 2: Targeting ── */}
          {step === 2 && (
            <div className="space-y-6">
              <p className="text-xs font-semibold text-slate-400">All targeting fields are optional. Leave empty to reach all users.</p>

              {/* Countries */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Countries</label>
                  <button
                    onClick={() => setSelectedCountries([])}
                    className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black border transition-all",
                      selectedCountries.length === 0
                        ? "bg-[#0c9de8] border-[#0c9de8] text-white"
                        : "bg-slate-50 border-slate-200 text-slate-500 hover:border-[#0c9de8]"
                    )}
                  >
                    🌍 Worldwide
                  </button>
                </div>

                {selectedCountries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCountries.map(code => {
                      const c = COUNTRIES.find(x => x.code === code);
                      return (
                        <button
                          key={code}
                          onClick={() => toggleCountry(code)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black text-white"
                          style={{ background: "#0c9de8" }}
                        >
                          {c?.flag} {c?.name}
                          <span className="ml-0.5 opacity-70">×</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={countrySearch}
                    onChange={e => setCountrySearch(e.target.value)}
                    placeholder="Search countries…"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:border-[#0c9de8] font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1">
                  {filteredCountries.map(c => {
                    const sel = selectedCountries.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        onClick={() => toggleCountry(c.code)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all",
                          sel ? "border-[#0c9de8]/40 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <span className="text-base">{c.flag}</span>
                        <span className={cn("text-xs font-bold", sel ? "text-[#0c9de8]" : "text-slate-700")}>{c.name}</span>
                        {sel && <Check size={12} className="ml-auto shrink-0 text-[#0c9de8]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Languages */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Languages</label>
                  {selectedLanguages.length > 0 && (
                    <button onClick={() => setSelectedLanguages([])} className="text-[10px] font-black text-slate-400 hover:text-red-500">
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map(l => {
                    const sel = selectedLanguages.includes(l.code);
                    return (
                      <button
                        key={l.code}
                        onClick={() => toggleLanguage(l.code)}
                        className={cn(
                          "px-3 py-2 rounded-xl text-[11px] font-black border transition-all",
                          sel ? "bg-[#0c9de8] border-[#0c9de8] text-white" : "bg-slate-50 border-slate-200 text-slate-500 hover:border-[#0c9de8]"
                        )}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] font-semibold text-slate-400">Empty = all languages.</p>
              </div>

              {/* VPN Policy */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">VPN Traffic</label>
                <div className="grid grid-cols-3 gap-2">
                  {VPN_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    const sel = form.vpn_policy === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setForm(p => ({ ...p, vpn_policy: opt.value }))}
                        className={cn(
                          "flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl border text-center transition-all",
                          sel ? "border-[#0c9de8]/40 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <Icon size={18} className={sel ? "text-[#0c9de8]" : "text-slate-400"} />
                        <p className={cn("text-[10px] font-black", sel ? "text-[#0c9de8]" : "text-slate-700")}>{opt.label}</p>
                        <p className="text-[9px] text-slate-400 font-medium leading-tight">{opt.sub}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Device */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Device Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {DEVICE_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    const sel = form.device_policy === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setForm(p => ({ ...p, device_policy: opt.value }))}
                        className={cn(
                          "flex flex-col items-center gap-2 py-3 rounded-2xl border transition-all",
                          sel ? "border-[#0c9de8]/40 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-300"
                        )}
                      >
                        <Icon size={18} className={sel ? "text-[#0c9de8]" : "text-slate-400"} />
                        <p className={cn("text-[10px] font-black", sel ? "text-[#0c9de8]" : "text-slate-700")}>{opt.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* OS */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Operating System</label>
                <div className="grid grid-cols-4 gap-2">
                  {OS_OPTIONS.map(opt => {
                    const sel = form.os_policy === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setForm(p => ({ ...p, os_policy: opt.value }))}
                        className={cn(
                          "py-2.5 rounded-xl border text-[11px] font-black transition-all",
                          sel ? "border-[#0c9de8]/40 bg-blue-50 text-[#0c9de8]" : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-300"
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Frequency Cap */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Frequency Cap <span className="text-slate-300 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Target size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.frequency_cap_per_user}
                    onChange={e => setForm(p => ({ ...p, frequency_cap_per_user: e.target.value }))}
                    placeholder="Max impressions per user per day"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 outline-none focus:border-[#0c9de8] placeholder:font-normal placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* Date range */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Exclude Mini Apps <span className="text-slate-300 font-normal">(optional)</span></label>
                <textarea
                  rows={4}
                  value={form.excluded_inventory}
                  onChange={(event) => setForm((previous) => ({ ...previous, excluded_inventory: event.target.value }))}
                  placeholder="@exampleapp, exampleapp, or https://t.me/exampleapp"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0c9de8]"
                />
                <p className="text-[10px] font-semibold text-slate-400">One per line or comma-separated. Entries are accepted privately without confirming whether the Mini App exists.</p>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Start Date", key: "start_at" as const },
                  { label: "End Date",   key: "end_at"   as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label} <span className="text-slate-300 font-normal">(optional)</span></label>
                    <div className="relative">
                      <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="datetime-local"
                        value={form[key]}
                        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 outline-none focus:border-[#0c9de8]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 3: Budget & Launch ── */}
          {step === 3 && (
            <div className="space-y-6">
              {/* CPM Bid */}
              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">CPM Bid <span className="text-red-400">*</span></label>

                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bid per 1,000 impressions</p>
                    {Number(form.advertiser_cpm_bid) >= recommendedCpm ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200">
                        <Sparkles size={9} /> Recommended
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200">
                        Below rec.
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <span className="text-2xl font-black text-slate-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min={cpmMin}
                      max={cpmMax}
                      value={form.advertiser_cpm_bid}
                      onChange={e => handleCpmInput(e.target.value)}
                      className="text-4xl font-black text-slate-800 w-28 text-center bg-transparent border-none outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white px-5 py-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Drag to adjust</span>
                  </div>
                  <div className="relative flex items-center" style={{ height: 44 }}>
                    <div className="absolute inset-x-0 rounded-full" style={{ height: 8, background: "#e2e8f0" }} />
                    <div className="absolute left-0 rounded-full pointer-events-none" style={{ height: 8, width: `${cpmPercent}%`, background: "linear-gradient(90deg,#0c9de8,#0b7ec9)" }} />
                    {/* Recommended tick */}
                    <div className="absolute pointer-events-none" style={{ left: `${recPct}%`, top: "50%", transform: "translate(-50%,-50%)", width: 3, height: 18, background: "#f59e0b", borderRadius: 2, opacity: 0.9 }} />
                    <input
                      type="range" min="0" max="100" step="0.5"
                      value={cpmPercent}
                      onChange={e => handleCpmSlider(Number(e.target.value))}
                      className="miniapp-cpm absolute inset-x-0 w-full"
                      style={{ height: 8 }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400">
                    <span>${cpmMin}</span>
                    <span className="text-amber-500 font-black">⭐ ${recommendedCpm.toFixed(2)} rec.</span>
                    <span>${cpmMax}</span>
                  </div>
                </div>
              </div>

              {/* Campaign Budget */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign Budget <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "custom",    label: "Custom Budget" },
                    { value: "unlimited", label: "Unlimited" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm(p => ({ ...p, campaign_budget_mode: opt.value }))}
                      className={cn(
                        "py-3 rounded-2xl border text-[11px] font-black transition-all",
                        form.campaign_budget_mode === opt.value
                          ? "border-[#0c9de8]/40 bg-blue-50 text-[#0c9de8]"
                          : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.campaign_budget_mode === "custom" && (
                  <div className="relative">
                    <DollarSign size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number" min="1" step="0.01"
                      value={form.budget}
                      onChange={e => setForm(p => ({ ...p, budget: e.target.value }))}
                      placeholder="Total campaign budget"
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 outline-none focus:border-[#0c9de8] placeholder:font-normal placeholder:text-slate-400"
                    />
                  </div>
                )}
                {form.campaign_budget_mode === "unlimited" && (
                  <p className="text-[11px] font-semibold text-slate-400 px-1">Runs until your ad balance is exhausted.</p>
                )}
              </div>

              {/* Daily Budget */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Daily Budget Cap <span className="text-slate-300 font-normal">(optional)</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "custom",    label: "Daily Limit" },
                    { value: "unlimited", label: "No Limit" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm(p => ({ ...p, daily_budget_mode: opt.value, daily_budget_limit: opt.value === "unlimited" ? "" : p.daily_budget_limit }))}
                      className={cn(
                        "py-3 rounded-2xl border text-[11px] font-black transition-all",
                        form.daily_budget_mode === opt.value
                          ? "border-[#0c9de8]/40 bg-blue-50 text-[#0c9de8]"
                          : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.daily_budget_mode === "custom" && (
                  <div className="relative">
                    <DollarSign size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number" min="1" step="0.01"
                      value={form.daily_budget_limit}
                      onChange={e => setForm(p => ({ ...p, daily_budget_limit: e.target.value }))}
                      placeholder="Max spend per day"
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 outline-none focus:border-[#0c9de8] placeholder:font-normal placeholder:text-slate-400"
                    />
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Campaign Summary</p>
                <div className="space-y-1.5 text-xs font-semibold text-slate-600">
                  <div className="flex justify-between"><span>Campaign</span><span className="font-black text-slate-900 truncate max-w-[60%] text-right">{form.campaign_name || "—"}</span></div>
                  <div className="flex justify-between"><span>Ad Title</span><span className="font-black text-slate-900 truncate max-w-[60%] text-right">{form.title || "—"}</span></div>
                  <div className="flex justify-between"><span>CPM Bid</span><span className="font-black text-[#0c9de8]">${Number(form.advertiser_cpm_bid || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Budget</span><span className="font-black text-slate-900">{form.campaign_budget_mode === "unlimited" ? "Unlimited" : form.budget ? `$${form.budget}` : "—"}</span></div>
                  <div className="flex justify-between"><span>Countries</span><span className="font-black text-slate-900">{selectedCountries.length === 0 ? "Worldwide" : `${selectedCountries.length} selected`}</span></div>
                  <div className="flex justify-between"><span>Languages</span><span className="font-black text-slate-900">{selectedLanguages.length === 0 ? "All" : selectedLanguages.join(", ")}</span></div>
                  <div className="flex justify-between"><span>Device</span><span className="font-black text-slate-900">{DEVICE_OPTIONS.find(d => d.value === form.device_policy)?.label}</span></div>
                  <div className="flex justify-between"><span>OS</span><span className="font-black text-slate-900">{OS_OPTIONS.find(o => o.value === form.os_policy)?.label}</span></div>
                  <div className="flex justify-between"><span>VPN</span><span className="font-black text-slate-900">{VPN_OPTIONS.find(v => v.value === form.vpn_policy)?.label}</span></div>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                  <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-red-700">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-emerald-700">{success}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Navigation ── */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-2 px-5 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 text-slate-600 text-xs font-black uppercase tracking-widest hover:bg-slate-100 transition-all"
              >
                <ChevronLeft size={15} /> Back
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => { setError(""); setStep(s => s + 1); }}
                disabled={step === 1 && !step1Valid}
                className={cn(
                  "flex-1 py-3.5 text-xs font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2",
                  (step === 1 && !step1Valid) ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "shiny-btn text-white"
                )}
              >
                Continue
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={saving || !step3Valid}
                className={cn(
                  "flex-1 py-3.5 text-xs font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2",
                  saving || !step3Valid ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "shiny-btn text-white"
                )}
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                {saving ? (isEditMode ? "Saving…" : "Submitting…") : (isEditMode ? "Save Changes" : "Launch Campaign")}
              </button>
            )}
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
