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

          <div className="space-y-6">
            {/* Amount Section */}
            <div className="space-y-4">
              <label className="text-sm font-bold text-slate-700">Enter amount (USD)</label>
              <div className="relative">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xl">$</div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full pl-12 pr-20 py-2 bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none transition-all font-black text-2xl text-slate-900"
                />
                <button
                  onClick={() => {
                    setAmount(availableBalance.toString());
                    setPercent(100);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-black"
                >
                  Max
                </button>
              </div>

              {/* Slider */}
              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={percent}
                  onChange={handleSliderChange}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                  <span>Min ${limits.min}</span>
                  <span>Max ${limits.max}</span>
                </div>
              </div>
            </div>

            {/* Network Selection */}
            <div className="space-y-4">
              <label className="text-sm font-bold text-slate-700">Select network</label>
              <div className="grid grid-cols-3 gap-3">
                {NETWORKS.map((net) => (
                  <button
                    key={net}
                    onClick={() => setNetwork(net)}
                    className={cn(
                      "relative py-3 px-2 text-sm font-bold rounded-xl border transition-all flex items-center justify-center",
                      network === net
                        ? "border-blue-500 bg-blue-50/30 text-blue-600"
                        : "border-slate-200 bg-white text-slate-500"
                    )}
                  >
                    {net}
                    {network === net && (
                      <CheckCircle2 size={16} className="absolute right-2 fill-blue-600 text-white" />
                    )}
                  </button>
                ))}
              </div>
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

            {/* Warning Box */}
            <div className="p-5 bg-amber-50 border border-amber-100 rounded-xl flex gap-4">
              <AlertCircle size={24} className="text-amber-500 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-amber-900">Important: <span className="font-medium text-amber-800">Ensure the address is correct. Funds sent to a wrong address or network cannot be recovered.</span></p>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={handleSubmit}
              disabled={isLoading || !amount || !address}
              className="w-full py-4 bg-blue-600/30 disabled:bg-slate-100 text-blue-700 disabled:text-slate-400 font-black rounded-xl transition-all text-base uppercase tracking-widest"
            >
              {isLoading ? <Loader2 className="animate-spin mx-auto" size={24} /> : "Submit Withdrawal"}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
