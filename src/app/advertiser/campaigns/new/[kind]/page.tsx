"use client";
/* eslint-disable react-hooks/set-state-in-effect -- legacy edit bootstrap intentionally seeds form state from the API */

import { useState, useEffect, useRef } from "react";
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
  Bot,
  Eye,
  MousePointer2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { useTranslations } from "@/i18n/client";
import { teaserErrorMessageKey } from "@/lib/teaserErrorMessage";
import type { TranslationKey } from "@/i18n/types";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { ALL_CATEGORIES, CAMPAIGN_CATEGORY_OPTIONS, campaignCategoryLabel, normalizeCampaignCategoryList } from "@/lib/campaignCategories";
import { hasRestrictedClickCreativeContent } from "@/lib/campaignCreative";
import dynamic from "next/dynamic";
import CampaignWizardShell from "@/components/advertiser/CampaignWizardShell";
import TelegramCampaignPreview from "@/components/advertiser/TelegramCampaignPreview";

const ImageCropDialog = dynamic(() => import("@/components/advertiser/ImageCropDialog"), { ssr: false });

const BUTTON_TEXTS = ["Learn more", "Get started", "Join channel", "Join group", "Start bot", "Buy Now", "Sign Up", "Download", "Visit site", "Play now", "Shop now"];
const TEASER_CTAS=["learn_more","click_here","join_now","join_channel","join_group","start_now","start_bot","open_now","view_more","get_started","buy_now","sign_up","download","visit_now","visit_site","play_now","shop_now"] as const;
const CONTINENTS = [
  { id: "global", name: "Global", countries: "All countries" },
  { id: "africa", name: "Africa", countries: "Nigeria, South Africa, Egypt, Kenya" },
  { id: "asia", name: "Asia", countries: "India, China, Japan" },
  { id: "europe", name: "Europe", countries: "United Kingdom, Germany, France, Italy, Spain" },
  { id: "north_america", name: "North America", countries: "United States, Canada, Mexico" },
  { id: "south_america", name: "South America", countries: "Brazil, Argentina, Colombia" },
  { id: "oceania", name: "Oceania", countries: "Australia, New Zealand" },
];

function campaignAudienceSelection(value: unknown, isBotCampaign: boolean) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
      const config = parsed as { mode?: unknown; audiences?: unknown };
      if (config.mode === "explicit") {
        return Array.isArray(config.audiences) ? config.audiences.map(String) : [];
      }
    }
    if (!Array.isArray(parsed)) return isBotCampaign ? CONTINENTS.map((continent) => continent.id) : [];
    if (isBotCampaign) return parsed.map(String);
    const normalized = Array.from(new Set(parsed.map((item) => String(item).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"))));
    if (normalized.length === CONTINENTS.length || normalized.includes("global")) return ["global"];
    return normalized.filter((item) => CONTINENTS.some((continent) => continent.id === item && item !== "global"));
  } catch {
    return isBotCampaign ? CONTINENTS.map((continent) => continent.id) : [];
  }
}

type AdvertiserDiscount = {
  cpm_discount: number;
  cpc_discount: number;
  expires_at: string | null;
  active: boolean;
};

export default function NewCampaignWizardPage() {
  const { setTitle } = useHeader();
  const { t } = useTranslations();
  const safeTeaserError=(code:unknown)=>t(teaserErrorMessageKey(code) as TranslationKey);
  const router = useRouter();
  const params = useParams<{ kind: string }>();
  const searchParams = useSearchParams();
  const isBotCampaign = params.kind === "bot";
  const isGrowthCampaign = params.kind === "growth";
  const presetType = searchParams.get("type");
  const presetIsTeaserOnly=presetType==="teaser";
  const editId = searchParams.get("edit");
  const isEditMode = Boolean(editId);
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
    min_cps: 0.25, recommended_cps: 0.56, max_cps: 5,
    teaser_min_cpm:0.5,teaser_recommended_cpm:0.89,teaser_max_cpm:6.5,
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
    button_text: "",
    cost_per_subscriber: "0.56",
    destination_channel: "",
    budget: "",
    cpm: "",
    cpc: "",
    continents: isBotCampaign ? CONTINENTS.map(c => c.id) : ["global"],
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
    teaser_mode:presetIsTeaserOnly?"teaser_only":"none",
    teaser_cta:"learn_more",
    teaser_cpm:"0.89",
  });
  const isTeaserOnly=presetIsTeaserOnly||formData.teaser_mode==="teaser_only";
  const [teaserVariants,setTeaserVariants]=useState(["", ""]);
  const selectedCategories = normalizeCampaignCategoryList(formData.category);
  const normalizedTeaserCopies = teaserVariants.map((value) => value.trim());
  const hasInvalidTeaserCopies = normalizedTeaserCopies.length < 2
    || normalizedTeaserCopies.some((value) => Array.from(value).length < 20 || Array.from(value).length > 80 || /(?:https?:\/\/|t\.me\/)/iu.test(value))
    || new Set(normalizedTeaserCopies.map((value) => value.toLocaleLowerCase())).size !== normalizedTeaserCopies.length;
  const toggleCategory = (value: (typeof CAMPAIGN_CATEGORY_OPTIONS)[number]["value"]) => {
    if (value === ALL_CATEGORIES) {
      setFormData((previous) => ({ ...previous, category: ALL_CATEGORIES }));
      return;
    }
    const current = selectedCategories.filter((category) => category !== ALL_CATEGORIES);
    const next = current.includes(value)
      ? current.filter((category) => category !== value)
      : current.length < 3 ? [...current, value] : current;
    setFormData((previous) => ({ ...previous, category: next.length ? next.join(",") : ALL_CATEGORIES }));
  };

  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [growthVerification, setGrowthVerification] = useState<{ channel: string; title: string; username?: string | null } | null>(null);
  const [growthVerificationError, setGrowthVerificationError] = useState("");
  const [isVerifyingGrowth, setIsVerifyingGrowth] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [teaserCtaOpen, setTeaserCtaOpen] = useState(false);
  const teaserCtaRef = useRef<HTMLDivElement>(null);
  const [advertiserDiscount, setAdvertiserDiscount] = useState<AdvertiserDiscount | null>(null);

  useEffect(() => {
    setTitle(t(isEditMode ? "advertiser.campaigns.edit" : isBotCampaign ? "advertiser.campaigns.botCampaign" : "advertiser.campaigns.channelCampaign"));
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
          min_cps: parseFloat(data.channel_growth_cps_min || "0.25"),
          recommended_cps: parseFloat(data.channel_growth_cps_recommended || "0.56"),
          max_cps: parseFloat(data.channel_growth_cps_max || "5.00"),
          teaser_min_cpm:parseFloat(data.teaser_min_cpm||"0.50"),teaser_recommended_cpm:parseFloat(data.teaser_recommended_cpm||"0.89"),teaser_max_cpm:parseFloat(data.teaser_max_cpm||"6.50"),
        });
        const defaultCpm = isBotCampaign
          ? recBroadcast.toString()
          : presetType === "clicks" ? recClicks.toString() : recViews.toString();
        if (!isEditMode) {
          setFormData(prev => ({
            ...prev,
            cpm: defaultCpm,
            cpc: presetType === "clicks" ? recClicks.toString() : "",
            budget: isGrowthCampaign ? "100" : data.min_campaign_budget || "10.0"
            ,teaser_cpm:data.teaser_recommended_cpm||"0.89"
          }));
        }
      })
      .catch((err) => console.error("Failed to fetch settings:", err));

    return () => {
      cancelled = true;
    };
  }, [isBotCampaign, isEditMode, presetType, setTitle, t]);

  useEffect(() => {
    apiFetch("/api/advertiser/rate-discount")
      .then((response) => response.ok ? response.json() : null)
      .then((discount) => setAdvertiserDiscount(discount?.active ? discount : null))
      .catch(() => setAdvertiserDiscount(null));
  }, []);

  useEffect(() => {
    if (!isEditMode || !editId) return;
    let cancelled = false;
    setIsLoading(true);
    apiFetch(`/api/advertiser/campaigns/${editId}`)
      .then((res) => res.json().then((data) => ({ data, ok: res.ok })))
      .then(({ data, ok }) => {
        if (cancelled) return;
        if (!ok) {
          setError(safeTeaserError(data?.code || data?.error));
          return;
        }
        const continents = campaignAudienceSelection(data.continents, isBotCampaign);
        setFormData((previous) => ({
          ...previous,
          name: data.name || "",
          campaign_title: data.campaign_title || "",
          category: data.category || ALL_CATEGORIES,
          type: data.type || defaultType,
          message_text: data.message_text || "",
          link: data.link || "",
          button_text: data.button_text || "",
          cost_per_subscriber: String(data.cost_per_subscriber || "0.56"),
          destination_channel: data.destination_chat_id ? String(data.destination_chat_id) : (data.link || ""),
          budget: String(data.total_budget || data.budget || ""),
          cpm: String(data.cpm || ""),
          cpc: String(data.cpc || data.cpm || ""),
          continents,
          countries: Array.isArray(data.countries) ? data.countries.join(",") : String(data.countries || ""),
          languages: Array.isArray(data.languages) ? data.languages.join(",") : String(data.languages || ""),
          vpn_policy: data.vpn_policy || "allow_all",
          device_policy: data.device_policy || "all",
          os_policy: data.os_policy || "all",
          start_at: data.start_at ? String(data.start_at).slice(0, 16) : "",
          end_at: data.end_at ? String(data.end_at).slice(0, 16) : "",
          daily_budget_limit: data.daily_budget_limit ? String(data.daily_budget_limit) : "",
          frequency_cap_per_user: data.frequency_cap_per_user ? String(data.frequency_cap_per_user) : "",
          excluded_inventory: Array.isArray(data.excluded_inventory) ? data.excluded_inventory.join("\n") : "",
          teaser_mode: data.teaser_mode || "none",
          teaser_cta: data.teaser_cta_key || "learn_more",
          teaser_cpm: String(data.teaser_cpm || "0.89"),
        }));
        if (Array.isArray(data.teaser_creatives) && data.teaser_creatives.length >= 2) setTeaserVariants(data.teaser_creatives.filter((item:{active?:number|boolean})=>item.active).map((item:{copy_text:string})=>String(item.copy_text)).slice(0,5));
        setImagePreview(data.image_url || null);
      })
      .catch(() => setError("Failed to load campaign"))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [defaultType, editId, isBotCampaign, isEditMode]);

  useEffect(() => {
    if (!categoryDropdownOpen && !teaserCtaOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!categoryDropdownRef.current?.contains(event.target as Node)) {
        setCategoryDropdownOpen(false);
      }
      if (!teaserCtaRef.current?.contains(event.target as Node)) setTeaserCtaOpen(false);
    };

    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [categoryDropdownOpen, teaserCtaOpen]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        setError("Image size cannot exceed 1MB");
        return;
      }
      setCropSource(file);
      setError("");
    }
  };

  const verifyGrowthChannel = async () => {
    setIsVerifyingGrowth(true);
    setGrowthVerificationError("");
    try {
      const response = await apiFetch("/api/advertiser/channel-growth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: formData.destination_channel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.verified) {
        const messages: Record<string, string> = {
          BOT_NOT_ADMIN: "Add Ads Galaxy Bot as a channel administrator.",
          BOT_INVITE_PERMISSION_REQUIRED: "Enable the bot's invite-users permission.",
          TELEGRAM_UNAVAILABLE: "Telegram verification is temporarily unavailable. Try again.",
          INVALID_DESTINATION_CHANNEL: "We couldn't verify this Telegram channel.",
        };
        throw new Error(messages[String(data.code)] || messages.INVALID_DESTINATION_CHANNEL);
      }
      setGrowthVerification({ channel: formData.destination_channel, title: String(data.title || "Telegram channel"), username: data.username || null });
    } catch (error) {
      setGrowthVerification(null);
      setGrowthVerificationError(error instanceof Error ? error.message : "We couldn't verify this Telegram channel.");
    } finally {
      setIsVerifyingGrowth(false);
    }
  };

  const checkRestrictedContent = (text: string) => {
    if (formData.type !== "clicks") return false;
    return hasRestrictedClickCreativeContent(text);
  };

  const growthMessageContainsUrl = (text: string) => isGrowthCampaign && /(?:https?:\/\/[^\s]+|www\.[^\s]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/iu.test(text);

  const hasValidCampaignObjective = () => {
    if (isGrowthCampaign) return true;
    if (isBotCampaign) return formData.type === "broadcast";
    return formData.type === "views" || formData.type === "clicks";
  };

  const handleSubmit = async () => {
    const trimmedName = (formData.name || "").trim();
    const trimmedCampaignTitle = (formData.campaign_title || "").trim();
    // English fallback: Select at least one target audience.
    if (!isBotCampaign && formData.continents.length === 0) {
      setError(t("advertiser.campaigns.selectAudience"));
      return;
    }
    if (trimmedName.length < 3) {
      setError(t("advertiser.campaigns.nameMin"));
      return;
    }
    if (trimmedName.length > 50) {
      setError(t("advertiser.campaigns.nameMax"));
      return;
    }
    if (!isTeaserOnly && trimmedCampaignTitle.length < 3) {
      setError(t("advertiser.campaigns.titleMin"));
      return;
    }
    if (!isTeaserOnly && trimmedCampaignTitle.length > 255) {
      setError(t("advertiser.campaigns.titleMax"));
      return;
    }
    if (isGrowthCampaign && !/^https:\/\/t\.me\/[A-Za-z0-9_+\/-]+$/i.test(formData.destination_channel.trim())) {
      setError(t("growth.destinationInvalid"));
      return;
    }
    if (isGrowthCampaign && growthVerification?.channel !== formData.destination_channel) {
      setError("Verify the destination channel before launching this campaign.");
      return;
    }
    if (isGrowthCampaign && (Number(formData.cost_per_subscriber) < limits.min_cps || Number(formData.cost_per_subscriber) > limits.max_cps)) {
      setError(`Cost per Subscriber must be between $${limits.min_cps.toFixed(2)} and $${limits.max_cps.toFixed(2)}.`);
      return;
    }

    if (!hasValidCampaignObjective()) {
      setError(isBotCampaign ? "Bot campaign format is required" : "Please select View Campaign or Click Campaign");
      return;
    }
    if (!isTeaserOnly && !formData.button_text) {
      setError("Please select a button text");
      return;
    }
    const minimumBudget = isGrowthCampaign ? 100 : 10;
    if (!isEditMode && (!Number.isFinite(Number(formData.budget)) || Number(formData.budget) < minimumBudget)) {
      setError(`Total budget must be at least $${minimumBudget}.`);
      return;
    }
    if (!isTeaserOnly && !formData.message_text.trim()) {
      setError("Message text is required.");
      return;
    }
    if (!isTeaserOnly && growthMessageContainsUrl(formData.message_text)) {
      setError("Channel Growth message text cannot contain URLs. Use the destination channel field below.");
      return;
    }
    if(formData.teaser_mode!=="none"){
      if(formData.type==="clicks"){setError(safeTeaserError("TEASER_NOT_AVAILABLE_FOR_CLICK"));return;}
      const normalized=teaserVariants.map(value=>value.trim());if(normalized.length<2||normalized.length>5){setError(safeTeaserError("INVALID_TEASER_COPY_COUNT"));return;}if(new Set(normalized.map(value=>value.toLocaleLowerCase())).size!==normalized.length){setError(safeTeaserError("DUPLICATE_TEASER_COPY"));return;}if(normalized.some(value=>Array.from(value).length<20)){setError(safeTeaserError("TEASER_COPY_TOO_SHORT"));return;}if(normalized.some(value=>Array.from(value).length>80)){setError(safeTeaserError("TEASER_COPY_TOO_LONG"));return;}if(normalized.some(value=>/(?:https?:\/\/|t\.me\/)/iu.test(value))){setError(safeTeaserError("TEASER_COPY_CONTAINS_URL"));return;}if(!TEASER_CTAS.includes(formData.teaser_cta as typeof TEASER_CTAS[number])){setError(safeTeaserError("INVALID_TEASER_CTA"));return;}
      if(Number(formData.teaser_cpm)<limits.teaser_min_cpm||Number(formData.teaser_cpm)>limits.teaser_max_cpm){setError(safeTeaserError("INVALID_TEASER_CPM"));return;}
    }
    if (!isTeaserOnly && formData.message_text.length > 1000) {
      setError("Message text must be at most 1000 characters.");
      return;
    }

    if (!isTeaserOnly && (checkRestrictedContent(formData.campaign_title) || checkRestrictedContent(formData.message_text))) {
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
    const minimumDailyBudget = isGrowthCampaign ? 50 : 10;
    if (formData.daily_budget_limit && Number(formData.daily_budget_limit) < minimumDailyBudget) {
      setError(`Daily budget must be at least $${minimumDailyBudget} when provided.`);
      return;
    }
    if (formData.frequency_cap_per_user && (!Number.isInteger(Number(formData.frequency_cap_per_user)) || Number(formData.frequency_cap_per_user) <= 0)) {
      setError("Frequency cap must be a positive whole number.");
      return;
    }
    setIsLoading(true);
    setError("");

    const submitData = new FormData();
    if (isEditMode) submitData.append("action", "edit");
    Object.entries(formData).forEach(([key, value]) => {
      if (key === "continents") {
        submitData.append(key, JSON.stringify(value));
      } else {
        submitData.append(key, value.toString());
      }
    });
    if (isTeaserOnly) {
      submitData.set("campaign_title", trimmedName);
      submitData.set("message_text", teaserVariants[0]?.trim() || trimmedName);
      submitData.set("button_text", formData.teaser_cta);
      submitData.set("cpm", formData.teaser_cpm);
    }

    if (image) {
      submitData.append("image", image);
    }
    submitData.set("teaser_variants",JSON.stringify(teaserVariants));
    submitData.set("direct_placement_mode", "network");
    submitData.set("direct_inventory_scope", "network");
    if (isGrowthCampaign) {
      submitData.set("campaign_kind", "channel_growth");
      submitData.set("billing_model", "cps");
      submitData.set("type", "views");
      submitData.set("link", formData.destination_channel);
    }
    submitData.append("direct_inventory_type", isBotCampaign ? "bot" : "channel");
    submitData.append("direct_inventory_ids", JSON.stringify([]));

    try {
      const res = await apiFetch(isEditMode ? `/api/advertiser/campaigns/${editId}` : "/api/advertiser/campaigns", {
        method: isEditMode ? "PATCH" : "POST",
        body: submitData,
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/advertiser/campaigns");
      } else {
        const errorCode = String(data?.code || "").trim();
        const errorMessage = String(data?.message || data?.error || "").trim();

        if (isTeaserOnly && errorCode) {
          const translated = safeTeaserError(errorCode);
          const generic = safeTeaserError("__UNKNOWN__");

          setError(
            translated !== generic
              ? translated
              : (errorMessage || errorCode || generic)
          );
        } else {
          setError(errorMessage || errorCode || t("errors.generic"));
        }
      }
    } catch {
      setError(t("errors.network"));
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
      if (!isBotCampaign) {
        if (id === "global") {
          return { ...prev, continents: prev.continents.includes("global") ? [] : ["global"] };
        }
        const withoutGlobal = prev.continents.filter((audience) => audience !== "global");
        return {
          ...prev,
          continents: withoutGlobal.includes(id)
            ? withoutGlobal.filter((audience) => audience !== id)
            : [...withoutGlobal, id],
        };
      }

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

  return (
    <DashboardLayout type="advertiser">
      {cropSource && <ImageCropDialog file={cropSource} onCancel={() => setCropSource(null)} onConfirm={(cropped) => {
        setImage(cropped);
        setImagePreview(URL.createObjectURL(cropped));
        setCropSource(null);
      }} />}
      <CampaignWizardShell
        step={step as 1 | 2 | 3}
        steps={isTeaserOnly ? [t("teaser.creativeTitle"), t("teaser.budgetTargeting")] : undefined}
        typeLabel={isGrowthCampaign ? "Channel Growth · CPS" : isBotCampaign ? "Bot Campaign · CPM" : `Channel Campaign · ${formData.type === "clicks" ? "CPC" : "CPM"}`}
        title={t(isEditMode ? "advertiser.campaigns.edit" : isBotCampaign ? "advertiser.campaigns.createBotAd" : "advertiser.campaigns.createChannelAd")}
        description={isEditMode ? "Update campaign settings. Creative changes return to review." : isTeaserOnly ? "Create and launch your Teaser in two focused steps." : "Create, preview, and launch in three focused steps."}
        onBack={() => router.back()}
        icon={isBotCampaign ? <Bot size={21} /> : isGrowthCampaign ? <PlusCircle size={21} /> : formData.type === "clicks" ? <MousePointer2 size={21} /> : <Eye size={21} />}
      >

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
            <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
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
              <TelegramCampaignPreview image={imagePreview} title={formData.campaign_title} message={formData.message_text} buttonText={formData.button_text} destination={isGrowthCampaign ? formData.destination_channel : formData.link} context={isBotCampaign ? "Bot sponsored message" : "Channel sponsored post"} />
            </div>
          </div>
        )}

        {/* Step 1: Basic Info */}
        {step === 1 && isTeaserOnly && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
            <header><h2 className="text-2xl font-black text-slate-950">{t("teaser.creativeTitle")}</h2><p className="text-sm text-slate-500">{t("teaser.creativeDescription")}</p></header>
            <div className="space-y-4 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
              <label className="block text-xs font-black uppercase text-slate-500"><span className="flex items-center justify-between"><span>{t("teaser.campaignName")}</span><span className={formData.name.length > 0 && formData.name.trim().length < 3 ? "text-red-500" : "text-slate-400"}>{formData.name.length}/50</span></span><input value={formData.name} maxLength={50} onChange={e=>setFormData({...formData,name:e.target.value})} className={cn("mt-1 w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100",formData.name.length > 0 && formData.name.trim().length < 3 ? "border-red-400 bg-red-50/30" : "border-slate-200")} placeholder={t("teaser.campaignName")}/>{formData.name.length > 0 && formData.name.trim().length < 3 && <span className="mt-2 flex items-center gap-1 text-[11px] font-bold normal-case text-red-500"><AlertCircle size={11}/> Minimum 3 characters required</span>}</label>
              <div ref={categoryDropdownRef}><p className="text-xs font-black uppercase text-slate-500">Category</p><div className="relative mt-1"><button type="button" onClick={()=>setCategoryDropdownOpen(value=>!value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"><span>{campaignCategoryLabel(formData.category)}</span><ChevronDown size={16} className={cn("transition",categoryDropdownOpen&&"rotate-180")}/></button>{categoryDropdownOpen&&<div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">{CAMPAIGN_CATEGORY_OPTIONS.map(cat=><button key={cat.value} type="button" onClick={()=>toggleCategory(cat.value)} disabled={cat.value!==ALL_CATEGORIES&&!selectedCategories.includes(cat.value)&&selectedCategories.filter(value=>value!==ALL_CATEGORIES).length>=3} className={cn("flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold disabled:opacity-40",selectedCategories.includes(cat.value)?"bg-sky-50 text-sky-600":"text-slate-700 hover:bg-slate-50")}><span>{cat.label}</span>{selectedCategories.includes(cat.value)&&<span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={10} strokeWidth={3}/></span>}</button>)}<p className="border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-slate-400">Select up to 3 categories</p></div>}</div></div>
              <label className="block text-xs font-black uppercase text-slate-500">{t("teaser.destinationUrl")}<input value={formData.link} onChange={e=>setFormData({...formData,link:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100" placeholder="https://example.com"/></label>
              <div ref={teaserCtaRef} className="relative"><p className="text-xs font-black uppercase text-slate-500">{t("teaser.callToAction")}</p><button type="button" onClick={()=>setTeaserCtaOpen(value=>!value)} className="mt-1 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"><span>{t(`teaser.cta.${formData.teaser_cta}` as TranslationKey)}</span><ChevronDown size={16} className={cn("transition",teaserCtaOpen&&"rotate-180")}/></button>{teaserCtaOpen&&<div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 grid max-h-64 grid-cols-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl sm:grid-cols-2">{TEASER_CTAS.map(key=><button key={key} type="button" onClick={()=>{setFormData(previous=>({...previous,teaser_cta:key}));setTeaserCtaOpen(false)}} className={cn("flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-semibold",formData.teaser_cta===key?"bg-sky-50 text-sky-600":"text-slate-700 hover:bg-slate-50")}><span>{t(`teaser.cta.${key}` as TranslationKey)}</span>{formData.teaser_cta===key&&<Check size={14} className="text-emerald-500"/>}</button>)}</div>}</div>
              <div><div className="flex items-center justify-between"><p className="text-xs font-black uppercase text-slate-500">{t("teaser.copies")}</p><span className="text-xs text-slate-400">{teaserVariants.length}/5</span></div><div className="mt-2 space-y-2">{teaserVariants.map((value,index)=>{const length=Array.from(value).length;const duplicate=teaserVariants.some((other,i)=>i!==index&&other.trim().toLocaleLowerCase()===value.trim().toLocaleLowerCase()&&value.trim());const url=/(?:https?:\/\/|t\.me\/)/iu.test(value);return <div key={index}><div className="flex gap-2"><textarea rows={2} maxLength={80} value={value} onChange={e=>setTeaserVariants(items=>items.map((item,i)=>i===index?e.target.value:item))} className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm" aria-label={`${t("teaser.copy")} ${index+1}`}/>{teaserVariants.length>2&&<button type="button" aria-label={`${t("teaser.removeCopy")} ${index+1}`} onClick={()=>setTeaserVariants(items=>items.filter((_,i)=>i!==index))} className="rounded-xl px-2 text-red-500"><Trash2 size={17}/></button>}</div><div className="mt-1 flex justify-between text-[10px]"><span className={duplicate||url||length<20?'text-red-500':'text-slate-400'}>{duplicate?t("teaser.duplicateCopy"):url?t("teaser.urlsNotAllowed"):length<20?t("teaser.minimumCharacters"):t("teaser.ready")}</span><span className={length>80?'text-red-500':'text-slate-400'}>{length}/80</span></div></div>})}</div>{teaserVariants.length<5&&<button type="button" onClick={()=>setTeaserVariants(items=>[...items,""])} className="mt-2 text-xs font-black text-sky-600">+ {t("teaser.addAnother")}</button>}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">{t("teaser.examplePublisherContent")}</p>
              <div className="my-3 border-t border-slate-200"/>
              <div className="space-y-3">
                {teaserVariants.map((copy,index)=>(
                  <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                    <p className="text-xs font-black text-slate-500">{t("teaser.sponsored")}</p>
                    <p className="mt-2 text-sm text-slate-900">{copy||t("teaser.copyPlaceholder")}</p>
                    <p className="mt-2 text-sm font-black text-sky-600">
                      {t(`teaser.cta.${formData.teaser_cta}` as TranslationKey)} →
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={()=>setStep(2)} disabled={formData.name.trim().length<3||!isValidUrl(formData.link)||hasInvalidTeaserCopies} className="w-full rounded-2xl bg-sky-600 py-4 text-sm font-black text-white disabled:bg-slate-200">{t("common.continue")} <ChevronRight className="inline" size={17}/></button>
          </div>
        )}

        {step === 1 && !isTeaserOnly && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">

            {/* Campaign type pill */}
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white" style={{ background: "#0c9de8" }}>
              {isBotCampaign ? <Bot size={13} /> : isGrowthCampaign ? <PlusCircle size={13} /> : formData.type === "views" ? <Eye size={13} /> : <MousePointer2 size={13} />}
              {isBotCampaign ? "Bot Campaign" : isGrowthCampaign ? t("growth.title") : formData.type === "views" ? "Views Campaign" : "Click Campaign"}
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
                        onClick={() => toggleCategory(cat.value)}
                        disabled={cat.value !== ALL_CATEGORIES && !selectedCategories.includes(cat.value) && selectedCategories.filter((value) => value !== ALL_CATEGORIES).length >= 3}
                        className={cn(
                          "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                          selectedCategories.includes(cat.value) ? "bg-blue-50 text-[#0c9de8] font-bold" : "text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        <span>{cat.label}</span>
                        {selectedCategories.includes(cat.value) && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={10} strokeWidth={3} /></span>}
                      </button>
                    ))}
                    <p className="border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-slate-400">Select up to 3 categories</p>
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
                  {isBotCampaign ? "Broadcast" : isGrowthCampaign ? t("growth.payPerVerified") : formData.type === "views" ? "Pay per View" : "Pay per Click"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isGrowthCampaign ? t("growth.billingExplanation") : isBotCampaign
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
              {t("advertiser.campaigns.nextStep")} <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* Step 2: Content */}
        {step === 2 && !isTeaserOnly && (
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
                  <p className="text-[11px] font-bold text-red-600">{t("advertiser.campaigns.titleMin")}</p>
                </div>
              )}
              {formData.campaign_title.length > 255 && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500 shrink-0" />
                  <p className="text-[11px] font-bold text-red-600">{t("advertiser.campaigns.titleMax")}</p>
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
                  checkRestrictedContent(formData.message_text) || growthMessageContainsUrl(formData.message_text) || formData.message_text.length > 1000 ? "border-red-400 bg-red-50/30" : "border-slate-200"
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

              {growthMessageContainsUrl(formData.message_text) && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="shrink-0 text-red-500" />
                  <p className="text-[11px] font-bold text-red-600">URLs are not allowed in Channel Growth message text. Use the destination channel field below.</p>
                </div>
              )}

            </div>

            {/* ── Image upload ── */}
            {!isTeaserOnly&&<div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
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
            </div>}

            {/* ── Link + Postback + Button ── */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Destination & Button</p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">{isGrowthCampaign ? t("growth.destination") : "Campaign Link"} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <LinkIcon size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="url"
                    value={isGrowthCampaign ? formData.destination_channel : formData.link}
                    onChange={(e) => {
                      setFormData({ ...formData, [isGrowthCampaign ? "destination_channel" : "link"]: e.target.value });
                      if (isGrowthCampaign) {
                        setGrowthVerification(null);
                        setGrowthVerificationError("");
                      }
                    }}
                    placeholder="https://t.me/yourchannel"
                    className={cn(
                      "w-full pl-10 pr-4 py-3 bg-slate-50 border rounded-xl focus:border-[#0c9de8] outline-none text-sm font-medium text-slate-900 transition-all",
                      (isGrowthCampaign ? formData.destination_channel : formData.link) && !isValidUrl(isGrowthCampaign ? formData.destination_channel : formData.link) ? "border-red-300" : "border-slate-200"
                    )}
                  />
                </div>
                {(isGrowthCampaign ? formData.destination_channel : formData.link) && !isValidUrl(isGrowthCampaign ? formData.destination_channel : formData.link) && (
                  <p className="text-[11px] font-bold text-red-500 px-1">Enter a valid URL (https://…)</p>
                )}
                {isGrowthCampaign && isValidUrl(formData.destination_channel) && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {growthVerification?.channel === formData.destination_channel ? (
                      <div className="flex items-start gap-2 text-emerald-700"><Check size={17} className="mt-0.5 shrink-0" /><div><p className="text-sm font-bold">Channel verified</p><p className="break-words text-xs">{growthVerification.title}{growthVerification.username ? ` · @${growthVerification.username}` : ""}</p><p className="mt-1 text-xs">Bot admin ✓ · Invite permission ✓</p></div></div>
                    ) : (
                      <div className="space-y-3">{growthVerificationError&&<div className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600"/><div><p className="text-sm font-bold text-slate-800">Channel not verified</p><p className="text-xs text-slate-500">{growthVerificationError}</p></div></div>}<div className="flex flex-wrap gap-2"><a href={`https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME||"Ads_Galaxy_bot"}?startchannel&admin=add_admins+post_messages+edit_messages+delete_messages+invite_users`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-50">Add us as admin</a><button type="button" onClick={verifyGrowthChannel} disabled={isVerifyingGrowth} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{isVerifyingGrowth&&<Loader2 size={14} className="animate-spin"/>} Verify Channel</button></div></div>
                    )}
                  </div>
                )}
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
              disabled={formData.campaign_title.trim().length < 3 || formData.campaign_title.length > 255 || !formData.message_text.trim() || formData.message_text.length > 1000 || growthMessageContainsUrl(formData.message_text)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#0c9de8]/30 bg-blue-50 py-3.5 text-xs font-black uppercase tracking-widest text-[#0c9de8] transition-colors hover:border-[#0c9de8]/50 hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Eye size={16} /> Preview Ads
            </button>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3.5 bg-slate-100 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 border border-slate-200"
              >
                <ChevronLeft size={16} /> {t("common.back")}
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={formData.campaign_title.trim().length < 3 || formData.campaign_title.length > 255 || !formData.message_text.trim() || formData.message_text.length > 1000 || growthMessageContainsUrl(formData.message_text) || !(isGrowthCampaign ? formData.destination_channel : formData.link) || !isValidUrl(isGrowthCampaign ? formData.destination_channel : formData.link) || (isGrowthCampaign && growthVerification?.channel !== formData.destination_channel) || !formData.button_text || checkRestrictedContent(formData.campaign_title) || checkRestrictedContent(formData.message_text)}
                className="flex-1 py-3.5 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-colors"
                style={{ background: (formData.campaign_title.trim().length < 3 || formData.campaign_title.length > 255 || !formData.message_text.trim() || formData.message_text.length > 1000 || growthMessageContainsUrl(formData.message_text) || !(isGrowthCampaign ? formData.destination_channel : formData.link) || !isValidUrl(isGrowthCampaign ? formData.destination_channel : formData.link) || (isGrowthCampaign && growthVerification?.channel !== formData.destination_channel) || !formData.button_text || checkRestrictedContent(formData.campaign_title) || checkRestrictedContent(formData.message_text)) ? undefined : "#0c9de8" }}
              >
                {t("common.next")} <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Budget & Targeting */}
        {step === (isTeaserOnly ? 2 : 3) && (() => {
          const cpmMin = formData.type === 'views' ? limits.min_cpm_views : formData.type === 'clicks' ? limits.min_cpm_clicks : limits.min_cpm_broadcast;
          const cpmMax = formData.type === 'views' ? limits.max_cpm_views : formData.type === 'clicks' ? limits.max_cpm_clicks : limits.max_cpm_broadcast;
          const recCpm = formData.type === 'views' ? limits.recommended_cpm_views : formData.type === 'clicks' ? limits.recommended_cpm_clicks : limits.recommended_cpm_broadcast;
          const bidField = formData.type === "clicks" ? "cpc" : "cpm";
          const bidLabel = formData.type === "clicks" ? "CPC" : "CPM";
          const bidValue = formData.type === "clicks" ? (formData.cpc || formData.cpm) : formData.cpm;
          const pricingMin = isTeaserOnly ? limits.teaser_min_cpm : isGrowthCampaign ? limits.min_cps : cpmMin;
          const pricingMax = isTeaserOnly ? limits.teaser_max_cpm : isGrowthCampaign ? limits.max_cps : cpmMax;
          const pricingRecommended = isTeaserOnly ? limits.teaser_recommended_cpm : isGrowthCampaign ? limits.recommended_cps : recCpm;
          const pricingValue = isTeaserOnly ? formData.teaser_cpm : isGrowthCampaign ? formData.cost_per_subscriber : bidValue;
          const pricingField = isTeaserOnly ? "teaser_cpm" : isGrowthCampaign ? "cost_per_subscriber" : bidField;
          const cpmVal = parseFloat(bidValue || "0");
          const discountAmount = advertiserDiscount?.active
            ? (formData.type === "clicks" ? Number(advertiserDiscount.cpc_discount || 0) : Number(advertiserDiscount.cpm_discount || 0))
            : 0;
          const effectiveBid = discountAmount > 0 ? Math.max(0.01, cpmVal - discountAmount) : cpmVal;
          const cpmPct = Math.min(100, Math.max(0, ((Number(pricingValue) - pricingMin) / Math.max(0.01, pricingMax - pricingMin)) * 100));
          const recPct = Math.min(100, Math.max(0, ((pricingRecommended - pricingMin) / Math.max(0.01, pricingMax - pricingMin)) * 100));
          const isAboveRec = Number(pricingValue) >= pricingRecommended;
          const estimatedReach = isGrowthCampaign
            ? Math.floor(Math.round(parseFloat(formData.budget || "0") * 100) / Math.max(1, Math.round(Number(pricingValue) * 100)))
            : Math.floor(parseFloat(formData.budget || "0") / Math.max(0.001, isTeaserOnly ? Number(pricingValue) : effectiveBid) * 1000);
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
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isTeaserOnly ? t("teaser.cpm") : isGrowthCampaign ? t("growth.cps") : `Your Bid (${bidLabel})`}</p>
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
                    {parseFloat(pricingValue || "0").toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] font-medium text-slate-400 mt-1.5">
                  {isGrowthCampaign ? t("growth.perVerifiedSubscriber") : `per 1,000 ${formData.type === "clicks" ? "clicks" : "views"}`}
                </p>
                {discountAmount > 0 && <p className="mt-1 text-[10px] font-bold text-violet-600">
                  −${discountAmount.toFixed(2)} discount · charged ${effectiveBid.toFixed(2)} / 1k{advertiserDiscount?.expires_at ? ` · until ${new Date(advertiserDiscount.expires_at).toLocaleDateString()}` : ""}
                </p>}
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
                <div className="relative mx-[17px] flex min-w-0 items-center" style={{ height: 52 }}>
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
                    min={pricingMin}
                    max={pricingMax}
                    step="0.05"
                    value={pricingValue}
                    disabled={isEditMode}
                    onChange={(e) => setFormData({ ...formData, [pricingField]: e.target.value, ...(!isGrowthCampaign && formData.type === "clicks" ? { cpm: e.target.value } : {}) })}
                    className="cpm-range absolute inset-x-0 box-border max-w-full disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ height: 10 }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Min</p>
                    <p className="text-sm font-black text-slate-600">${pricingMin}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">⭐ Rec.</p>
                    <p className="text-sm font-black text-amber-600">${pricingRecommended.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Max</p>
                    <p className="text-sm font-black text-slate-600">${pricingMax}</p>
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
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("advertiser.campaigns.totalBudget")} <span className="text-red-400">*</span></p>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  step="1"
                  min={isGrowthCampaign ? 100 : limits.min_budget}
                  value={formData.budget}
                  onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                  placeholder="0.00"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#0c9de8] outline-none text-xl font-black text-slate-900 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400">Minimum budget: <span className="font-black text-slate-600">${isGrowthCampaign ? 100 : limits.min_budget}</span></p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 pt-2">{t("advertiser.campaigns.dailyBudget")} <span className="font-normal normal-case">({t("common.optional")})</span></p>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  step="1"
                  min={isGrowthCampaign ? 50 : 10}
                  value={formData.daily_budget_limit}
                  onChange={(e) => setFormData({ ...formData, daily_budget_limit: e.target.value })}
                  placeholder="No daily cap"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-[#0c9de8] outline-none text-sm font-bold text-slate-900 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400">If set, minimum ${isGrowthCampaign ? 50 : 10} and no more than the total budget.</p>
            </div>

            {/* ── Reach estimate ── */}
            <div className="rounded-2xl p-5 flex items-center justify-between gap-4" style={{ background: "linear-gradient(135deg, #0c9de8 0%, #0b7ec9 100%)" }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/60">{isGrowthCampaign ? t("growth.estimatedSubscribers") : "Estimated Reach"}</p>
                <p className="text-2xl font-black text-white mt-1">
                  {estimatedReach > 0 ? estimatedReach.toLocaleString() : "—"}
                  <span className="text-sm font-bold text-white/70 ml-1.5">{isGrowthCampaign ? t("growth.subscribers") : formData.type}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Campaign Budget</p>
                <p className="text-xl font-black text-white mt-1">${parseFloat(formData.budget || "0").toFixed(2)}</p>
              </div>
            </div>
            <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">{isGrowthCampaign ? "You are charged only for verified subscribers, up to this campaign budget." : "You are charged only as valid campaign results are delivered, up to this campaign budget."}</p>

            {/* ── Continents ── */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("advertiser.campaigns.targetAudience")}</p>
              {!isBotCampaign && <p className="text-[11px] font-semibold text-slate-500">Global is a standalone audience. Select one or combine specific regions.</p>}
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
              <button onClick={() => setStep(isTeaserOnly?1:2)} className="flex-1 py-3.5 bg-slate-100 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 border border-slate-200">
                <ChevronLeft size={16} /> {t("common.back")}
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading || !formData.budget || Number(formData.budget) < (isGrowthCampaign ? 100 : limits.min_budget) || (Boolean(formData.daily_budget_limit) && Number(formData.daily_budget_limit) < (isGrowthCampaign ? 50 : 10)) || !pricingValue || (!isBotCampaign && formData.continents.length === 0) || (isGrowthCampaign && growthVerification?.channel !== formData.destination_channel)}
                className="flex-1 py-3.5 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 transition-colors"
                style={{ background: (isLoading || !formData.budget || Number(formData.budget) < (isGrowthCampaign ? 100 : limits.min_budget) || (Boolean(formData.daily_budget_limit) && Number(formData.daily_budget_limit) < (isGrowthCampaign ? 50 : 10)) || !pricingValue || (!isBotCampaign && formData.continents.length === 0)) ? undefined : "#0c9de8" }}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
                {isLoading ? "Creating…" : "Launch Campaign"}
              </button>
            </div>
          </div>
          );
        })()}
      </CampaignWizardShell>
    </DashboardLayout>
  );
}
