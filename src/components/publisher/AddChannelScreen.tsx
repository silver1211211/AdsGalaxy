"use client";

import React, { useState, useEffect } from "react";
import {
  Search,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Info,
  ChevronLeft,
  Tv,
  Plus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import Toast from "@/components/ui/Toast";
import { getDefaultPostingTimes, normalizePostingTimes, POSTING_TIME_OPTIONS } from "@/lib/postingTimes";

const CATEGORIES = ["Crypto", "Finance", "NSFW +18", "Tech", "Gambling", "Entertainment", "Education", "Shopping", "Other"];
const CONTINENTS = [
  { name: "Global", countries: "All countries" },
  { name: "Africa", countries: "Nigeria, South Africa, Egypt, Kenya" },
  { name: "Asia", countries: "India, China, Japan, Indonesia" },
  { name: "Europe", countries: "UK, Germany, France, Italy, Spain" },
  { name: "North America", countries: "USA, Canada, Mexico" },
  { name: "South America", countries: "Brazil, Argentina, Colombia" },
  { name: "Oceania", countries: "Australia, New Zealand" }
];

function getInitialPostingTimes(channel: { posting_times?: unknown } | undefined, postsPerDay: number) {
  try {
    return normalizePostingTimes(channel?.posting_times, postsPerDay);
  } catch {
    return getDefaultPostingTimes(postsPerDay);
  }
}

interface AddChannelScreenProps {
  onClose: () => void;
  onSuccess: () => void;
  channel?: any; // Optional for edit mode
}

export default function AddChannelScreen({ onClose, onSuccess, channel }: AddChannelScreenProps) {
  const isEdit = !!channel;
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [username, setUsername] = useState(channel?.username || "");
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);
  const [channelInfo, setChannelInfo] = useState<any>(channel || null);
  
  // Modal states
  const [permissionModal, setPermissionModal] = useState<{
    isOpen: boolean;
    message: string;
  }>({
    isOpen: false,
    message: ""
  });

  // Form fields
  const [editedTitle, setEditedTitle] = useState(channel?.title || "");
  const [postsPerDay, setPostsPerDay] = useState(channel?.posts_per_day || 1);
  const [postingTimes, setPostingTimes] = useState<string[]>(() => getInitialPostingTimes(channel, channel?.posts_per_day || 1));
  const [postingTimesError, setPostingTimesError] = useState("");
  const [selectedContinents, setSelectedContinents] = useState<string[]>(
    channel?.audience_continents ? (typeof channel.audience_continents === 'string' ? JSON.parse(channel.audience_continents) : channel.audience_continents) : []
  );
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    channel?.categories ? (typeof channel.categories === 'string' ? JSON.parse(channel.categories) : channel.categories) : []
  );

  // Telegram Back Button Logic
  useEffect(() => {
    const twa = (window as any).Telegram?.WebApp;
    if (twa?.BackButton) {
      twa.BackButton.show();
      const handleBack = () => {
        if (!isEdit && step > 1) {
          setStep(1);
        } else {
          onClose();
        }
      };
      twa.BackButton.onClick(handleBack);

      return () => {
        twa.BackButton.offClick(handleBack);
        twa.BackButton.hide();
      };
    }
  }, [step, onClose, isEdit]);

  const handleFetchInfo = async () => {
    if (!username) return;
    setIsLoading(true);
    setNotification(null);
    try {
      const res = await apiFetch(`/api/telegram/chat-info?username=${username}`);
      const data = await res.json();
      
      if (!res.ok) {
        if (data.error === "PERMISSION_REQUIRED") {
          setPermissionModal({
            isOpen: true,
            message: data.message
          });
          return;
        }
        throw new Error(data.error || "Failed to fetch channel info");
      }

      setChannelInfo(data);
      setEditedTitle(data.title);
      setStep(2);
    } catch (err: any) {
      setNotification({
        type: "error",
        title: "Search Failed",
        message: err.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(cat)) {
        return prev.filter(c => c !== cat);
      }
      if (prev.length >= 3) return prev;
      return [...prev, cat];
    });
  };

  const toggleContinent = (name: string) => {
    setSelectedContinents(prev => {
      if (name === "Global") {
        return prev.includes("Global") ? [] : CONTINENTS.map(c => c.name);
      }

      let next: string[];
      if (prev.includes(name)) {
        next = prev.filter(c => c !== name && c !== "Global");
      } else {
        next = [...prev, name];
        if (next.length === CONTINENTS.length - 1) {
          next = CONTINENTS.map(c => c.name);
        }
      }
      return next;
    });
  };

  const handlePostsPerDayChange = (value: number) => {
    setPostsPerDay(value);
    setPostingTimesError("");
    setPostingTimes(prev => {
      const allowedCount = Math.min(value, 3);
      const next = prev.slice(0, allowedCount);
      return next.length > 0 ? next : getDefaultPostingTimes(value);
    });
  };

  const togglePostingTime = (time: string) => {
    setPostingTimes(prev => {
      if (prev.includes(time)) {
        if (prev.length === 1) {
          setPostingTimesError("Select at least 1 posting time");
          return prev;
        }

        setPostingTimesError("");
        return prev.filter(item => item !== time);
      }

      if (prev.length >= Math.min(postsPerDay, 3)) {
        setPostingTimesError(`Select up to ${Math.min(postsPerDay, 3)} posting ${postsPerDay === 1 ? "time" : "times"}`);
        return prev;
      }

      setPostingTimesError("");
      return normalizePostingTimes([...prev, time], postsPerDay);
    });
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setNotification(null);
    try {
      const res = await apiFetch(isEdit ? `/api/publisher/channels/${channel.id}` : "/api/publisher/channels", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify({
          chat_id: isEdit ? channel.chat_id : channelInfo.id,
          username: isEdit ? channel.username : channelInfo.username,
          title: editedTitle,
          posts_per_day: postsPerDay,
          posting_times: postingTimes,
          audience_continents: selectedContinents,
          categories: selectedCategories,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? 'update' : 'add'} channel`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setNotification({
        type: "error",
        title: isEdit ? "Update Failed" : "Registration Failed",
        message: err.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";
  const botAdminLink = `https://t.me/${botUsername}?startchannel&admin=add_admins+post_messages+edit_messages+delete_messages+invite_users`;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed top-16 left-0 right-0 bottom-0 z-[55] bg-white flex flex-col"
    >
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-8">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                <div className="space-y-4">
                  <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <Tv size={28} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Find your Channel</h2>
                    <p className="text-sm text-slate-500">Add your public Telegram channel to the network.</p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Channel Username</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                        <span className="text-blue-500 font-black text-lg">@</span>
                      </div>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace("@", ""))}
                        placeholder="username"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all outline-none font-bold text-lg text-slate-900"
                      />
                    </div>
                  </div>
                </div>

                {/* BOT ADMIN ACTION */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[#0c9de8]">
                    <CheckCircle2 size={20} className="fill-current text-white bg-[#0c9de8] rounded-full" />
                    <span className="font-black text-xs uppercase tracking-widest">Step 1: Authorization</span>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Grant admin permissions to our bot in your channel to enable automated ad management.
                  </p>
                  <a
                    href={botAdminLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 bg-[#0c9de8] text-white rounded-2xl text-sm font-black hover:bg-blue-600 transition-all"
                  >
                    Add Bot as Admin <ExternalLink size={16} />
                  </a>
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleFetchInfo}
                    disabled={!username || isLoading}
                    className="w-full py-3.5 bg-slate-900 disabled:bg-slate-200 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                    2. Continue to Configuration
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-10"
              >
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                      <CheckCircle2 size={28} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-900">Configure</h2>
                      <p className="text-sm text-slate-500">Reviewing @{channelInfo.username}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Display Name</label>
                        <input
                          type="text"
                          value={editedTitle}
                          onChange={(e) => setEditedTitle(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border-none rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/20 outline-none transition-all font-bold text-slate-900"
                        />
                      </div>
                      <div className="space-y-1 opacity-60">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chat ID</label>
                        <div className="px-4 py-2.5 bg-slate-100 rounded-xl font-mono text-xs font-bold text-slate-600 overflow-hidden truncate">
                          {isEdit ? channelInfo.chat_id : channelInfo.id}
                        </div>
                      </div>
                    </div>

                    {/* CUSTOM SLIDING RADIO FOR POST FREQUENCY */}
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block text-center">Post Frequency (Per Day)</label>
                      <div className="relative w-full max-w-[320px] h-10 bg-slate-100 p-1 rounded-full flex items-center mx-auto">
                        {/* Slider Indicator */}
                        <motion.div
                          className="absolute h-8 bg-white rounded-full shadow-sm"
                          initial={false}
                          animate={{
                            left: `${(postsPerDay - 1) * 33.333}%`,
                            width: "33.333%",
                            x: postsPerDay === 1 ? 4 : postsPerDay === 2 ? 0 : -4
                          }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                        {[1, 2, 3].map((num) => (
                          <button
                            key={num}
                            onClick={() => handlePostsPerDayChange(num)}
                            className={cn(
                              "relative z-10 flex-1 h-full flex items-center justify-center font-black text-xs transition-colors duration-300",
                              postsPerDay === num ? "text-[#0c9de8]" : "text-slate-400"
                            )}
                          >
                            {num} {num === 1 ? 'post' : 'posts'}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] font-bold tracking-tighter text-center">
                        <span className="text-[#0c9de8]">Tip:</span> <span className="text-slate-400">1-2 posts for maximum engagement</span>
                      </p>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Posting Times</label>
                      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                        {POSTING_TIME_OPTIONS.map((time) => (
                          <button
                            key={time}
                            onClick={() => togglePostingTime(time)}
                            className={cn(
                              "px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all border",
                              postingTimes.includes(time)
                                ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                : "bg-white border-slate-200 text-slate-400 hover:border-blue-200"
                            )}
                          >
                            {time}
                          </button>
                        ))}
                      </div>
                      <p className={cn(
                        "text-[10px] font-bold tracking-tighter",
                        postingTimesError ? "text-red-500" : "text-slate-400"
                      )}>
                        {postingTimesError || `Select ${postsPerDay === 1 ? "1 time" : `up to ${postsPerDay} times`} in 30-minute intervals.`}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Channel Categories (Max 3)</label>
                      <div className="flex flex-wrap gap-2">
                        {CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => toggleCategory(cat)}
                            className={cn(
                              "px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all border",
                              selectedCategories.includes(cat)
                                ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100"
                                : "bg-white border-slate-200 text-slate-400 hover:border-blue-200"
                            )}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Audience</label>
                      <div className="grid grid-cols-1 gap-2">
                        {CONTINENTS.map((cont) => (
                          <button
                            key={cont.name}
                            onClick={() => toggleContinent(cont.name)}
                            className={cn(
                              "px-5 py-3 text-sm font-bold rounded-2xl transition-all flex flex-col items-start gap-1 text-left border-2",
                              selectedContinents.includes(cont.name)
                                ? "bg-blue-50 border-blue-500/30 text-blue-700"
                                : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100"
                            )}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-black text-base">{cont.name}</span>
                              {selectedContinents.includes(cont.name) && <CheckCircle2 size={18} />}
                            </div>
                            <span className={cn(
                              "text-[10px] font-bold uppercase tracking-wider",
                              selectedContinents.includes(cont.name) ? "text-blue-400" : "text-slate-400"
                            )}>
                              {cont.countries}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pb-6">
                  <button
                    onClick={() => setStep(1)}
                    className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-black rounded-2xl hover:bg-slate-200 transition-all text-sm"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isLoading || selectedContinents.length === 0 || selectedCategories.length === 0 || postingTimes.length === 0 || postingTimes.length > postsPerDay}
                    className="flex-1 py-3.5 bg-[#0c9de8] hover:bg-blue-600 disabled:bg-slate-200 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    {isLoading && <Loader2 className="animate-spin" size={20} />}
                    Complete
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <ConfirmationModal
        isOpen={permissionModal.isOpen}
        onClose={() => setPermissionModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => setPermissionModal(prev => ({ ...prev, isOpen: false }))}
        title="Admin Required"
        message={permissionModal.message}
        confirmBtnText="I've added the bot"
        closeBtnText="Close"
      />
      <Toast
        isOpen={!!notification}
        onClose={() => setNotification(null)}
        type={notification?.type || "success"}
        title={notification?.title || ""}
        message={notification?.message || ""}
      />
    </motion.div>
  );
}
