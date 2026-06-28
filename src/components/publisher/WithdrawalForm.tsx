"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Coins
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";

const NETWORKS = ["BEP-20", "TRC-20", "ERC-20"];

const NETWORK_FEES: Record<string, number> = {
  "BEP-20": 0,
  "TRC-20": 2,
  "ERC-20": 1,
};

interface WithdrawalFormProps {
  availableBalance: number;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
}

export default function WithdrawalForm({ availableBalance, onClose, onSuccess, title = "Withdraw Funds" }: WithdrawalFormProps) {
  const { setTitle } = useHeader();
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState("BEP-20");
  const [address, setAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [limits, setLimits] = useState({ min: 10, max: 500 });

  // Range slider value (percentage)
  const [percent, setPercent] = useState(0);

  // Set header title
  useEffect(() => {
    setTitle(title);
    return () => setTitle("Withdrawals"); // Revert when closing
  }, [title, setTitle]);

  // Fetch settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await apiFetch("/api/settings");
        const data = await res.json();
        if (res.ok) {
          setLimits({
            min: parseFloat(data.min_withdraw || "10"),
            max: parseFloat(data.max_withdraw || "500")
          });
        }
      } catch (err) {
        console.error("Failed to fetch limits:", err);
      }
    };
    fetchSettings();
  }, []);

  // Update amount when slider moves
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setPercent(val);
    const calculated = (val / 100) * availableBalance;
    setAmount(calculated.toFixed(2));
  };

  // Telegram Back Button Logic
  useEffect(() => {
    const twa = window.Telegram?.WebApp;
    if (twa?.BackButton) {
      twa.BackButton.show();
      twa.BackButton.onClick(onClose);
      return () => {
        twa.BackButton.offClick(onClose);
        twa.BackButton.hide();
      };
    }
  }, [onClose]);

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val < limits.min) {
      setError(`Minimum withdrawal is $${limits.min}`);
      return;
    }
    if (val > limits.max) {
      setError(`Maximum withdrawal is $${limits.max}`);
      return;
    }
    if (val > availableBalance) {
      setError("Insufficient available balance");
      return;
    }
    if (!address) {
      setError("Please enter a wallet address");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/publisher/withdrawals", {
        method: "POST",
        body: JSON.stringify({ amount: val, network, address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to place withdrawal");

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
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
          {/* Mockup Header Section */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-400">Available for withdrawal</p>
              <h2 className="text-4xl font-black text-emerald-600 tracking-tight">
                ${availableBalance.toFixed(2)}
              </h2>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-xs font-medium text-slate-400">Available</span>
              </div>
            </div>
            <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
              <Coins size={40} />
            </div>
          </div>

          <style>{`
            .withdraw-range { -webkit-appearance: none; appearance: none; background: transparent; outline: none; }
            .withdraw-range::-webkit-slider-thumb { -webkit-appearance: none; width: 32px; height: 32px; border-radius: 50%; background: #0c9de8; border: 4px solid white; box-shadow: 0 2px 12px rgba(12,157,232,0.45), 0 0 0 2px rgba(12,157,232,0.2); cursor: grab; }
            .withdraw-range:active::-webkit-slider-thumb { cursor: grabbing; box-shadow: 0 4px 20px rgba(12,157,232,0.65), 0 0 0 8px rgba(12,157,232,0.12); }
            .withdraw-range::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: #0c9de8; border: 4px solid white; box-shadow: 0 2px 12px rgba(12,157,232,0.45); cursor: grab; }
            .withdraw-range:active::-moz-range-thumb { cursor: grabbing; }
          `}</style>

          <div className="space-y-6">
            {/* Amount Section */}
            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-700">Enter amount (USD)</label>
              <div className="relative">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xl">$</div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    const pct = availableBalance > 0 ? Math.min(100, (parseFloat(e.target.value || "0") / availableBalance) * 100) : 0;
                    setPercent(pct);
                  }}
                  placeholder="0.00"
                  className="w-full pl-11 pr-20 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:border-[#0c9de8] outline-none transition-all font-black text-2xl text-slate-900"
                />
                <button
                  onClick={() => { setAmount(availableBalance.toFixed(2)); setPercent(100); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs font-black text-white rounded-xl"
                  style={{ background: "#0c9de8" }}
                >
                  MAX
                </button>
              </div>

              {/* Slider */}
              <div className="rounded-2xl border border-slate-100 bg-white px-5 py-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Drag to set amount</span>
                  <span className="text-[10px] font-black text-[#0c9de8]">{Math.round(percent)}%</span>
                </div>
                <div className="relative flex items-center" style={{ height: 48 }}>
                  <div className="absolute inset-x-0 rounded-full" style={{ height: 9, background: "#e2e8f0" }} />
                  <div
                    className="absolute left-0 rounded-full pointer-events-none"
                    style={{ height: 9, width: `${percent}%`, background: "linear-gradient(90deg, #0c9de8 0%, #0b7ec9 100%)" }}
                  />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={percent}
                    onChange={handleSliderChange}
                    className="withdraw-range absolute inset-x-0 w-full"
                    style={{ height: 9 }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Min ${limits.min}</span>
                  <span>Max ${limits.max}</span>
                </div>
              </div>
            </div>

            {/* Network Selection */}
            <div className="space-y-4">
              <label className="text-sm font-bold text-slate-700">Select network</label>
              <div className="grid grid-cols-3 gap-3">
                {NETWORKS.map((net) => {
                  const netFee = NETWORK_FEES[net] ?? 0;
                  return (
                    <button
                      key={net}
                      onClick={() => setNetwork(net)}
                      className={cn(
                        "relative py-3 px-2 rounded-xl border transition-all flex flex-col items-center justify-center gap-0.5",
                        network === net
                          ? "border-blue-500 bg-blue-50/30 text-blue-600"
                          : "border-slate-200 bg-white text-slate-500"
                      )}
                    >
                      <span className="text-sm font-bold">{net}</span>
                      <span className={cn(
                        "text-[10px] font-black",
                        netFee === 0 ? "text-emerald-500" : "text-amber-500"
                      )}>
                        {netFee === 0 ? "No fee" : `-$${netFee} fee`}
                      </span>
                      {network === net && (
                        <CheckCircle2 size={16} className="absolute right-2 top-2 fill-blue-600 text-white" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Fee breakdown */}
              {parseFloat(amount) > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold text-slate-600">
                    <span>Withdrawal amount</span>
                    <span>${parseFloat(amount || "0").toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold text-amber-600">
                    <span>Network fee ({network})</span>
                    <span>- ${(NETWORK_FEES[network] ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm font-black text-emerald-600">
                    <span>You receive</span>
                    <span>${Math.max(0, parseFloat(amount || "0") - (NETWORK_FEES[network] ?? 0)).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Address Input */}
            <div className="space-y-4">
              <label className="text-sm font-bold text-slate-700">{network} wallet address</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <Wallet size={20} />
                </div>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter your address"
                  className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-sm text-slate-900"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-red-700">{error}</p>
              </div>
            )}

            {/* Warning Box */}
            <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-amber-800 leading-relaxed">
                <span className="font-black text-amber-900">Important: </span>
                Ensure the address is correct. Funds sent to a wrong address or network cannot be recovered.
              </p>
            </div>
          </div>

          <div className="pt-2 pb-4">
            <button
              onClick={handleSubmit}
              disabled={isLoading || !amount || !address}
              className="w-full py-4 text-white disabled:bg-slate-100 disabled:text-slate-400 font-black rounded-2xl transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"
              style={{ background: (isLoading || !amount || !address) ? undefined : "#0c9de8" }}
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : "Submit Withdrawal"}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
