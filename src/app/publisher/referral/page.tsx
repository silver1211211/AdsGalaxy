"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Users,
  Copy,
  Share2,
  Gift,
  TrendingUp,
  UserPlus,
  Check,
  ChevronRight
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";

export default function ReferralPage() {
  const { setTitle } = useHeader();
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTitle("Referral");
    fetchData();
  }, [setTitle]);

  const fetchData = async () => {
    try {
      const res = await apiFetch("/api/publisher/referrals");
      const json = await res.json();
      if (res.ok) setData(json);
    } catch (error) {
      console.error("Error fetching referrals:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!data?.referral_link) return;
    navigator.clipboard.writeText(data.referral_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    // Telegram haptic feedback if available
    const twa = (window as any).Telegram?.WebApp;
    if (twa?.HapticFeedback) {
      twa.HapticFeedback.impactOccurred("light");
    }
  };

  const handleShare = () => {
    if (!data?.referral_link) return;
    const twa = (window as any).Telegram?.WebApp;
    if (twa?.openTelegramLink) {
      const text = encodeURIComponent(`Join this bot and start earning from your Telegram channels! 🚀\n\n${data.referral_link}`);
      twa.openTelegramLink(`https://t.me/share/url?url=${data.referral_link}&text=${text}`);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout type="publisher">
        <div className="space-y-6 animate-pulse">
          <div className="h-48 bg-slate-100 rounded-2xl" />
          <div className="h-24 bg-slate-100 rounded-2xl" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-slate-100 rounded-2xl" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout type="publisher">
      <div className="space-y-8">
        {/* Referral Program Info */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-8 text-white space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Gift size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">Refer & Earn</h2>
              <p className="text-blue-100 text-xs font-bold uppercase tracking-wider opacity-80">Earn 5% of your friends' earnings</p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Your Referral Link</p>
            <div className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 font-mono text-sm truncate">
              {data?.referral_link}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={copyToClipboard}
                className="py-4 bg-white text-blue-600 rounded-xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                {copied ? <Check size={20} /> : <Copy size={20} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleShare}
                className="py-4 bg-white/20 text-white rounded-xl flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest active:scale-[0.98] transition-all"
              >
                <Share2 size={20} />
                Share
              </button>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-2">
            <div className="flex items-center gap-2 text-slate-400">
              <TrendingUp size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">Total Earned</span>
            </div>
            <p className="text-2xl font-black text-slate-900">${parseFloat(data?.total_earnings || 0).toFixed(2)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-2">
            <div className="flex items-center gap-2 text-slate-400">
              <Users size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">Invited</span>
            </div>
            <p className="text-2xl font-black text-slate-900">{data?.referrals?.length || 0}</p>
          </div>
        </div>

        {/* Referrals List */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-100 text-slate-400 rounded-lg flex items-center justify-center">
              <UserPlus size={18} />
            </div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Your Referrals</h2>
          </div>

          {!data?.referrals ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 animate-pulse">
                  <div className="w-12 h-12 bg-slate-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-100 rounded-md w-24" />
                    <div className="h-3 bg-slate-50 rounded-md w-32" />
                  </div>
                  <div className="w-5 h-5 bg-slate-50 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          ) : data.referrals.length === 0 ? (
            <div className="py-16 text-center space-y-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
              <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center mx-auto text-slate-200">
                <Users size={32} />
              </div>
              <div className="space-y-1 px-6">
                <p className="text-slate-900 font-black text-sm uppercase tracking-tight">No Referrals Yet</p>
                <p className="text-slate-400 text-[10px] font-bold uppercase leading-relaxed">
                  Share your link with other channel owners and start earning today!
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {data.referrals.map((referral: any, i: number) => (
                <div
                  key={i}
                  className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4"
                >
                  {referral.photo_url ? (
                    <img
                      src={referral.photo_url}
                      alt={referral.first_name}
                      className="w-12 h-12 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-black text-xl">
                      {referral.first_name.charAt(0)}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm truncate">
                      {referral.first_name} {referral.last_name}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                      @{referral.username || "no_username"} • Joined {new Date(referral.created_at).toLocaleDateString([], { dateStyle: 'medium' })}
                    </p>
                  </div>

                  <div className="shrink-0">
                    <ChevronRight size={20} className="text-slate-300" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}