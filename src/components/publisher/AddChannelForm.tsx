"use client";

import React, { useState } from "react";
import { 
  X, 
  Search, 
  Loader2, 
  CheckCircle2, 
  ExternalLink,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface AddChannelFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

const CONTINENTS = [
  "Global", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"
];

export default function AddChannelForm({ onClose, onSuccess }: AddChannelFormProps) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [channelInfo, setChannelInfo] = useState<any>(null);
  
  // Form fields
  const [editedTitle, setEditedTitle] = useState("");
  const [postsPerDay, setPostsPerDay] = useState(1);
  const [selectedContinents, setSelectedContinents] = useState<string[]>([]);

  const handleFetchInfo = async () => {
    if (!username) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/telegram/chat-info?username=${username}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch channel info");
      
      setChannelInfo(data);
      setEditedTitle(data.title);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleContinent = (cont: string) => {
    setSelectedContinents(prev => 
      prev.includes(cont) 
        ? prev.filter(c => c !== cont) 
        : [...prev, cont]
    );
  };

  const handleSubmit = async () => {
    const trimmedTitle = editedTitle.trim();
    if (trimmedTitle.length < 3) {
      setError("Channel name must be at least 3 characters.");
      return;
    }
    if (trimmedTitle.length > 50) {
      setError("Channel name must be at most 50 characters.");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/publisher/channels", {
        method: "POST",
        body: JSON.stringify({
          chat_id: channelInfo.id,
          username: channelInfo.username,
          channel_type: "public",
          subscriber_count: channelInfo.subscriber_count,
          title: editedTitle,
          posts_per_day: postsPerDay,
          audience_continents: selectedContinents,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add channel");
      }
      
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";
  const botAdminLink = `https://t.me/${botUsername}?startchannel&admin=add_admins+post_messages+edit_messages+delete_messages+invite_users`;

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-w-2xl w-full mx-auto animate-in fade-in zoom-in duration-300">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Add New Channel</h3>
          <p className="text-xs text-slate-500">Step {step} of 2</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="p-8">
        {step === 1 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Channel Username</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-slate-400 font-medium">@</span>
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace("@", ""))}
                  placeholder="channel_username"
                  className="w-full pl-8 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900"
                />
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Info size={12} />
                Enter the public username of your Telegram channel.
              </p>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-start gap-3">
                <div className="mt-0.5">⚠️</div>
                <p>{error}</p>
              </div>
            )}

            <button
              onClick={handleFetchInfo}
              disabled={!username || isLoading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
              Next Step
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Channel Info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Display Name</label>
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    maxLength={50}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Posts Per Day</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((num) => (
                      <button
                        key={num}
                        onClick={() => setPostsPerDay(num)}
                        className={cn(
                          "flex-1 py-3 rounded-xl border font-bold transition-all",
                          postsPerDay === num 
                            ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100" 
                            : "bg-white border-slate-200 text-slate-600 hover:border-blue-200"
                        )}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Audience */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Audience Continent</label>
                <div className="grid grid-cols-2 gap-2">
                  {CONTINENTS.map((cont) => (
                    <button
                      key={cont}
                      onClick={() => toggleContinent(cont)}
                      className={cn(
                        "px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-left flex items-center justify-between",
                        selectedContinents.includes(cont)
                          ? "bg-blue-50 border-blue-200 text-blue-700"
                          : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                      )}
                    >
                      {cont}
                      {selectedContinents.includes(cont) && <CheckCircle2 size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Admin Bot Requirement */}
            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
              <div className="flex items-center gap-2 text-blue-800 font-bold text-sm">
                <CheckCircle2 size={18} />
                Bot Admin Permission Required
              </div>
              <p className="text-xs text-blue-700 leading-relaxed">
                To track ads and performance, you must add our bot as an administrator to your channel with post/delete permissions.
              </p>
              <a 
                href={botAdminLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
              >
                Add Bot to Channel <ExternalLink size={14} />
              </a>
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center font-medium">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-all"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading || selectedContinents.length === 0}
                className="flex-[2] py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {isLoading && <Loader2 className="animate-spin" size={20} />}
                Submit Channel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
