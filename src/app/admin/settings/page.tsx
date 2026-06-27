"use client";

import React, { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Loader2, Edit2, ShieldAlert, Upload, Megaphone } from "lucide-react";

type SelfPromotionForm = {
  enabled: boolean;
  status: string;
  title: string;
  description: string;
  cta_text: string;
  cta_url: string;
  countdown_seconds: string;
  frequency_hours: string;
  start_at: string;
  end_at: string;
  max_impressions_per_user: string;
  image_data_url?: string | null;
};

const defaultSelfPromotionForm: SelfPromotionForm = {
  enabled: true,
  status: "active",
  title: "Host Your Telegram Bot For Free",
  description: "Create, host, and manage your Telegram bots easily with BothostPro.",
  cta_text: "Host Free Bot",
  cta_url: "https://bothostpro.com",
  countdown_seconds: "5",
  frequency_hours: "24",
  start_at: "",
  end_at: "",
  max_impressions_per_user: "",
  image_data_url: null,
};

function datetimeLocal(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSetting, setEditingSetting] = useState<any>(null);
  const [editValue, setEditValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoVersion, setLogoVersion] = useState(Date.now());
  const [promoForm, setPromoForm] = useState<SelfPromotionForm>(defaultSelfPromotionForm);
  const [promoStats, setPromoStats] = useState<any>(null);
  const [promoImage, setPromoImage] = useState<File | null>(null);
  const [promoSaving, setPromoSaving] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSettings(data.settings || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch settings");
    } finally {
      setLoading(false);
    }
  };

  const fetchSelfPromotion = async () => {
    try {
      const res = await fetch("/api/admin/self-promotion", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch self promotion ad");
      if (data.ad) {
        setPromoForm({
          enabled: Boolean(data.ad.enabled),
          status: data.ad.status || "active",
          title: data.ad.title || defaultSelfPromotionForm.title,
          description: data.ad.description || defaultSelfPromotionForm.description,
          cta_text: data.ad.cta_text || defaultSelfPromotionForm.cta_text,
          cta_url: data.ad.cta_url || defaultSelfPromotionForm.cta_url,
          countdown_seconds: String(data.ad.countdown_seconds || 5),
          frequency_hours: String(data.ad.frequency_hours || 24),
          start_at: datetimeLocal(data.ad.start_at),
          end_at: datetimeLocal(data.ad.end_at),
          max_impressions_per_user: data.ad.max_impressions_per_user ? String(data.ad.max_impressions_per_user) : "",
          image_data_url: data.ad.image_data_url || null,
        });
      }
      setPromoStats(data.stats || null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch self promotion ad");
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchSelfPromotion();
  }, []);

  const openEditModal = (setting: any) => {
    setEditingSetting(setting);
    setEditValue(setting.value);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSetting) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: editingSetting.key, value: editValue })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save setting");

      setIsModalOpen(false);
      fetchSettings();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogoUpload = async () => {
    if (!logoFile) return;

    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", logoFile);

      const res = await fetch("/api/admin/logo", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload logo");

      setLogoFile(null);
      setLogoVersion(Date.now());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLogoUploading(false);
    }
  };

  const updatePromoField = (key: keyof SelfPromotionForm, value: string | boolean) => {
    setPromoForm((current) => ({ ...current, [key]: value }));
  };

  const handleSelfPromotionSave = async (removeImage = false) => {
    setPromoSaving(true);
    try {
      const formData = new FormData();
      formData.append("enabled", promoForm.enabled ? "1" : "0");
      formData.append("status", promoForm.status);
      formData.append("title", promoForm.title);
      formData.append("description", promoForm.description);
      formData.append("cta_text", promoForm.cta_text);
      formData.append("cta_url", promoForm.cta_url);
      formData.append("countdown_seconds", promoForm.countdown_seconds);
      formData.append("frequency_hours", promoForm.frequency_hours);
      formData.append("start_at", promoForm.start_at);
      formData.append("end_at", promoForm.end_at);
      formData.append("max_impressions_per_user", promoForm.max_impressions_per_user);
      if (removeImage) formData.append("remove_image", "1");
      if (promoImage) formData.append("image", promoImage);

      const res = await fetch("/api/admin/self-promotion", {
        method: "PUT",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save self promotion ad");
      setPromoImage(null);
      await fetchSelfPromotion();
    } catch (err: any) {
      setError(err.message || "Failed to save self promotion ad");
    } finally {
      setPromoSaving(false);
    }
  };

  return (
    <AdminLayout>
      {/* Error Modal */}
      {error && (
        <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-lg w-full max-w-md shadow-2xl border border-red-200 overflow-hidden">
            <div className="bg-red-50 p-4 border-b border-red-100 flex items-center gap-3">
              <ShieldAlert className="text-red-600" size={24} />
              <h3 className="font-bold text-red-900 text-lg">Error</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-700 text-sm leading-relaxed mb-6">{error}</p>
              <div className="flex justify-end">
                <button 
                  onClick={() => setError("")}
                  className="px-5 py-2 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isModalOpen && editingSetting && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">Edit Setting</h3>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">{editingSetting.key}</label>
                {editingSetting.description && (
                  <p className="text-xs text-slate-500 mb-3">{editingSetting.description}</p>
                )}
                <input 
                  type="text" 
                  required
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-100px)]">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">System Settings</h2>
        </div>
        
        <div className="overflow-y-auto flex-1 bg-slate-50/50 p-4 space-y-4">
          <div className="bg-white border border-blue-100 rounded-lg p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Megaphone size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Self Promotion Ad</h3>
                  <p className="text-xs text-slate-500">Reusable in-app announcement or partner promo shown inside AdsGalaxy.</p>
                </div>
              </div>
              {promoStats && (
                <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                  <div className="rounded-lg bg-slate-50 px-3 py-2"><b>{Number(promoStats.impressions || 0).toLocaleString()}</b><br />Impr.</div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2"><b>{Number(promoStats.clicks || 0).toLocaleString()}</b><br />Clicks</div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2"><b>{Number(promoStats.dismissals || 0).toLocaleString()}</b><br />Dismiss</div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2"><b>{(Number(promoStats.ctr || 0) * 100).toFixed(2)}%</b><br />CTR</div>
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
              <div className="space-y-3">
                <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-center text-xs text-slate-400">
                  {promoForm.image_data_url ? (
                    <img src={promoForm.image_data_url} alt="Self promotion preview" className="h-full w-full object-cover" />
                  ) : (
                    <span>No image<br />160 x 160</span>
                  )}
                </div>
                <label className="block w-40 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer">
                  Upload PNG/JPG/WEBP
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => setPromoImage(e.target.files?.[0] || null)}
                  />
                </label>
                {promoImage && <p className="w-40 truncate text-[11px] text-slate-500" title={promoImage.name}>{promoImage.name}</p>}
                {promoForm.image_data_url && (
                  <button
                    onClick={() => handleSelfPromotionSave(true)}
                    disabled={promoSaving}
                    className="w-40 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                  >
                    Remove Image
                  </button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={promoForm.enabled} onChange={(e) => updatePromoField("enabled", e.target.checked)} />
                  Enable promotion
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">Status</span>
                  <select value={promoForm.status} onChange={(e) => updatePromoField("status", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-bold text-slate-600">Title</span>
                  <input value={promoForm.title} onChange={(e) => updatePromoField("title", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-bold" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-bold text-slate-600">Description</span>
                  <textarea value={promoForm.description} onChange={(e) => updatePromoField("description", e.target.value)} rows={3} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-normal" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">CTA Button Text</span>
                  <input value={promoForm.cta_text} onChange={(e) => updatePromoField("cta_text", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">CTA URL</span>
                  <input value={promoForm.cta_url} onChange={(e) => updatePromoField("cta_url", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">Countdown Seconds</span>
                  <input type="number" min="1" max="30" value={promoForm.countdown_seconds} onChange={(e) => updatePromoField("countdown_seconds", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">Display Frequency Hours</span>
                  <input type="number" min="1" max="720" value={promoForm.frequency_hours} onChange={(e) => updatePromoField("frequency_hours", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">Start Date</span>
                  <input type="datetime-local" value={promoForm.start_at} onChange={(e) => updatePromoField("start_at", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">End Date</span>
                  <input type="datetime-local" value={promoForm.end_at} onChange={(e) => updatePromoField("end_at", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-600">Max Impressions Per User</span>
                  <input type="number" min="1" value={promoForm.max_impressions_per_user} placeholder="No cap" onChange={(e) => updatePromoField("max_impressions_per_user", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <div className="flex items-end justify-end">
                  <button
                    onClick={() => handleSelfPromotionSave(false)}
                    disabled={promoSaving}
                    className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 md:w-auto"
                  >
                    {promoSaving ? "Saving..." : "Save Self Promotion Ad"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                <img src={`/logo.svg?v=${logoVersion}`} alt="Current logo" className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Homepage Logo</h3>
                <p className="text-[11px] text-slate-500 truncate">Upload any image type. Saved as the homepage logo.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="px-3 py-2 bg-slate-50 text-slate-600 border border-slate-200 rounded-md text-xs font-medium hover:bg-slate-100 cursor-pointer whitespace-nowrap">
                Choose Image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                />
              </label>
              <button
                onClick={handleLogoUpload}
                disabled={!logoFile || logoUploading}
                className="px-3 py-2 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {logoUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload
              </button>
            </div>
            {logoFile && (
              <p className="text-[11px] text-slate-500 sm:max-w-[160px] truncate" title={logoFile.name}>{logoFile.name}</p>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" size={24} /></div>
          ) : settings.length === 0 ? (
            <div className="text-center p-12 text-slate-500 text-sm">No settings found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {settings
                .filter((s: any) => s.key !== "last_broadcast_cron_run")
                .map((setting: any) => (
                <div key={setting.key} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-sm font-bold text-slate-900 break-all">{setting.key}</h3>
                      <button 
                        onClick={() => openEditModal(setting)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer shrink-0"
                        title="Edit Setting"
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                    {setting.description && (
                      <p className="text-xs text-slate-500 mb-4 leading-relaxed">{setting.description}</p>
                    )}
                  </div>
                  <div className="bg-slate-50 p-2 rounded border border-slate-100 mt-2">
                    <span className="font-mono text-sm text-blue-700 break-all">{setting.value}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
