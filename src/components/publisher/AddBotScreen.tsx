"use client";

import React, { useState, useEffect } from "react";
import {
  Search,
  Loader2,
  CheckCircle2,
  Info,
  Bot,
  Globe
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import Toast from "@/components/ui/Toast";

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

interface AddBotScreenProps {
  onClose: () => void;
  onSuccess: () => void;
  bot?: any; // Optional for edit mode
}

export default function AddBotScreen({ onClose, onSuccess, bot }: AddBotScreenProps) {
  const isEdit = !!bot;
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [token, setToken] = useState(bot?.bot_token || "");
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; title: string; message: string } | null>(null);
  const [botInfo, setBotInfo] = useState<any>(
    bot 
      ? { ...bot, first_name: bot.bot_name, username: bot.bot_username } 
      : null
  );
  
  // Form fields
  const [postsPerDay, setPostsPerDay] = useState(bot?.posts_per_day || 1);
  const [selectedContinents, setSelectedContinents] = useState<string[]>(
    bot?.continents ? (typeof bot.continents === 'string' ? JSON.parse(bot.continents) : bot.continents) : []
  );
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    bot?.categories ? (typeof bot.categories === 'string' ? JSON.parse(bot.categories) : bot.categories) : []
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

  const handleValidateToken = async () => {
    if (!token) return;
    setIsLoading(true);
    setNotification(null);
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const tgData = await tgRes.json();
      if (!tgData.ok) throw new Error("Invalid bot token");

      setBotInfo({
        username: tgData.result.username,
        first_name: tgData.result.first_name
      });
      setStep(2);
    } catch (err: any) {
      setNotification({
        type: "error",
        title: "Validation Failed",
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

  const handleSubmit = async () => {
    setIsLoading(true);
    setNotification(null);
    try {
      const res = await apiFetch(isEdit ? `/api/publisher/bots/${bot.id}` : "/api/publisher/bots", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify({
          bot_token: token,
          posts_per_day: postsPerDay,
          continents: selectedContinents,
          categories: selectedCategories,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? 'update' : 'add'} bot`);
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
                  <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-[#0c9de8]">
                    <Bot size={28} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Add your Bot</h2>
                    <p className="text-sm text-slate-500">Monetize your Telegram bot by serving ads.</p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Bot API Token</label>
                    <input
                      type="text"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="123456789:ABCDefGhIjKlMnOpQrStUvWxYz"
                      className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all outline-none font-mono text-sm text-slate-900"
                    />
                    <p className="text-[10px] text-slate-400 font-medium">
                      You can get this token from <a href="https://t.me/BotFather" target="_blank" className="text-[#0c9de8] underline">@BotFather</a>.
                    </p>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleValidateToken}
                    disabled={!token || isLoading}
                    className="w-full py-3.5 bg-slate-900 disabled:bg-slate-200 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
                    Continue to Configuration
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
                      <h2 className="text-2xl font-black text-slate-900">{botInfo?.first_name || "Configure Bot"}</h2>
                      <p className="text-sm text-slate-500">@{botInfo?.username}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* POST FREQUENCY */}
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block text-center">Post Frequency (Per Day)</label>
                      <div className="relative w-full max-w-[320px] h-10 bg-slate-100 p-1 rounded-full flex items-center mx-auto">
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
                            onClick={() => setPostsPerDay(num)}
                            className={cn(
                              "relative z-10 flex-1 h-full flex items-center justify-center font-black text-xs transition-colors duration-300",
                              postsPerDay === num ? "text-[#0c9de8]" : "text-slate-400"
                            )}
                          >
                            {num} {num === 1 ? 'post' : 'posts'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bot Categories (Max 3)</label>
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
                  {!isEdit && (
                    <button
                      onClick={() => setStep(1)}
                      className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-black rounded-2xl hover:bg-slate-200 transition-all text-sm"
                    >
                      Back
                    </button>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={isLoading || selectedContinents.length === 0 || selectedCategories.length === 0}
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
