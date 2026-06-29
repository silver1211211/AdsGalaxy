"use client";

import React, { useCallback, useState, useEffect } from "react";
import Image from "next/image";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Wallet,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Copy,
  DollarSign,
  ArrowRight,
  Info,
  Loader2,
  AlertCircle,
  Check,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useHeader } from "@/context/HeaderContext";
import { AnimatePresence, motion } from "framer-motion";
import Modal from "@/components/ui/Modal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import { OXAPAY_DEPOSIT_NETWORKS } from "@/lib/oxapayNetworks";

interface Deposit {
  id: number;
  track_id: string;
  order_id: string;
  amount: number;
  pay_amount: number;
  currency: string;
  pay_currency: string;
  network: string;
  address: string;
  status: string;
  expired_at: number;
  created_at: string;
}

type DepositNetwork = {
  id: string;
  oxapayNetwork: string;
  name: string;
  chain: string;
  currency: string;
  icon: string;
  tone: string;
  logo: string;
  networkLogo: string;
};

type TelegramWebApp = {
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred: (type: "success" | "error" | "warning") => void;
    selectionChanged: () => void;
  };
};

function getTelegramWebApp() {
  return (window as unknown as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

const DEFAULT_NETWORKS: DepositNetwork[] = OXAPAY_DEPOSIT_NETWORKS;

export default function DepositPage() {
  const { setTitle } = useHeader();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState("USDT_BSC");
  const [viewingDeposit, setViewingDeposit] = useState<Deposit | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [minDeposit, setMinDeposit] = useState<number>(5.0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [error, setError] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [limit, setLimit] = useState(10);
  const [depositNetworks, setDepositNetworks] = useState<DepositNetwork[]>(DEFAULT_NETWORKS);

  const pendingDeposit = deposits.find(d => ["pending", "waiting", "paying"].includes(d.status));

  // Filter and Paginate logic
  const getFilteredDeposits = () => {
    // Active ones always stay at top
    const active = deposits.filter(d => ["pending", "waiting", "paying"].includes(d.status));
    const history = deposits.filter(d => !["pending", "waiting", "paying"].includes(d.status));

    let filteredHistory = history;
    if (activeFilter === "paid") filteredHistory = history.filter(d => d.status === "paid");
    if (activeFilter === "canceled") filteredHistory = history.filter(d => d.status === "canceled" || d.status === "expired");

    // Recombine: Active first, then filtered history
    return [...active, ...filteredHistory];
  };

  const allVisibleDeposits = getFilteredDeposits();
  const paginatedDeposits = allVisibleDeposits.slice(0, limit);
  const hasMore = allVisibleDeposits.length > limit;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (viewingDeposit && ["pending", "waiting", "paying"].includes(viewingDeposit.status)) {
      interval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const diff = viewingDeposit.expired_at - now;
        if (diff <= 0) {
          setTimeLeft("EXPIRED");
          clearInterval(interval);
        } else {
          const mins = Math.floor(diff / 60);
          const secs = diff % 60;
          setTimeLeft(`${mins}:${secs.toString().padStart(2, "0")}`);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [viewingDeposit]);

  const fetchDeposits = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await apiFetch("/api/advertiser/deposits");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch deposits");
      setDeposits(data.deposits);
      setMinDeposit(data.minDeposit);
      if (Array.isArray(data.networks) && data.networks.length > 0) {
        setDepositNetworks(data.networks);
        if (!data.networks.some((item: DepositNetwork) => item.id === network)) {
          setNetwork(data.networks[0].id);
        }
      }
    } catch (err) {
      console.error(err);
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setTitle("Deposit");
    void Promise.resolve().then(() => fetchDeposits());
  }, [fetchDeposits, setTitle]);

  useEffect(() => {
    const webapp = getTelegramWebApp();
    if (webapp) {
      const handleBack = () => {
        if (isPaying) setIsPaying(false);
        else setViewingDeposit(null);
      };

      if (viewingDeposit || isPaying) {
        webapp.BackButton.show();
        webapp.BackButton.onClick(handleBack);
      } else {
        webapp.BackButton.hide();
      }
      return () => webapp.BackButton.offClick(handleBack);
    }
  }, [viewingDeposit, isPaying]);

  const handleCreate = async () => {
    const webapp = getTelegramWebApp();
    if (webapp) webapp.HapticFeedback?.impactOccurred('medium');

    if (!amount || parseFloat(amount) < minDeposit || isCreating) return;
    setIsCreating(true);
    try {
      const res = await apiFetch("/api/advertiser/deposits", {
        method: "POST",
        body: JSON.stringify({ amount, network })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create deposit");

      setViewingDeposit(data);
      setIsPaying(true);
      setAmount("");
      fetchDeposits(true);
      if (webapp) webapp.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      setError(errorMessage(err));
      if (webapp) webapp.HapticFeedback?.notificationOccurred('error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = async (track_id: string) => {
    const webapp = getTelegramWebApp();
    if (webapp) webapp.HapticFeedback?.impactOccurred('medium');

    if (isCanceling) return;
    setIsCanceling(true);
    try {
      const res = await apiFetch(`/api/advertiser/deposits/${track_id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to cancel deposit");
      }
      setViewingDeposit(null);
      // Optimistic update
      setDeposits(prev => prev.map(d => d.track_id === track_id ? { ...d, status: 'canceled' } : d));
      fetchDeposits(true);
      if (webapp) webapp.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      setError(errorMessage(err));
      if (webapp) webapp.HapticFeedback?.notificationOccurred('error');
    } finally {
      setIsCanceling(false);
    }
  };

  const handleCheckStatus = async (track_id: string) => {
    const webapp = getTelegramWebApp();
    if (webapp) webapp.HapticFeedback?.impactOccurred('medium');

    if (isChecking) return;
    setIsChecking(true);
    setStatusMessage("");
    try {
      const res = await apiFetch(`/api/advertiser/deposits/${track_id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check status");

      if (viewingDeposit?.track_id === track_id) {
        setViewingDeposit(data);
        if (data.status === "paid") {
          setStatusMessage("Payment received! Your balance has been updated.");
          if (webapp) webapp.HapticFeedback?.notificationOccurred('success');
          setTimeout(() => {
            setIsPaying(false);
            setViewingDeposit(null);
            setStatusMessage("");
          }, 2000);
        } else {
          setStatusMessage("Payment not received yet. Please wait a moment.");
          setTimeout(() => setStatusMessage(""), 3000);
        }
      }
      fetchDeposits(true);
    } catch (err) {
      setError(errorMessage(err));
      if (webapp) webapp.HapticFeedback?.notificationOccurred('error');
    } finally {
      setIsChecking(false);
    }
  };

  const copyToClipboard = (text: string) => {
    const webapp = getTelegramWebApp();
    if (webapp) webapp.HapticFeedback?.impactOccurred('light');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case "paid": return { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50", label: "Paid" };
      case "expired": return { icon: XCircle, color: "text-red-500", bg: "bg-red-50", label: "Expired" };
      case "canceled": return { icon: XCircle, color: "text-slate-400", bg: "bg-slate-50", label: "Canceled" };
      case "paying": return { icon: Clock, color: "text-amber-500", bg: "bg-amber-50", label: "Processing" };
      default: return { icon: Clock, color: "text-amber-500", bg: "bg-amber-50", label: "Pending" };
    }
  };


  return (
    <DashboardLayout type="advertiser">
      <div className="mx-auto max-w-xl space-y-6">
        <Modal isOpen={!!error} onClose={() => setError("")} type="error" title="Deposit Error">
          {error}
        </Modal>

        <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-blue-950/20">
          <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#0c9de8]/30 blur-3xl" />
          <div className="relative space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-blue-100">
              <Sparkles size={12} />
              Balance launchpad
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Fund campaigns faster.</h1>
              <p className="mt-2 max-w-sm text-sm font-medium leading-relaxed text-blue-100/75">
                Create a crypto invoice, monitor payment status, and keep your campaign balance ready.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 p-3 text-blue-100">
              <ShieldCheck size={18} className="shrink-0" />
              <p className="text-[11px] font-bold leading-relaxed">Deposit logic and payment flow are unchanged.</p>
            </div>
          </div>
        </div>

        {/* Create Deposit Section */}
        <div className="space-y-5 rounded-[2rem] border border-blue-100 bg-white p-4 shadow-xl shadow-blue-100/50 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100/60 bg-blue-50 text-blue-600 shadow-sm">
              <Wallet size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Add Balance</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fund your advertiser account</p>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Amount to deposit ($)</label>
                <span className="text-[9px] font-black uppercase tracking-widest text-[#0c9de8]">Min: ${minDeposit.toFixed(2)}</span>
              </div>
              <div className="relative">
                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={17} />
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={!!pendingDeposit || isCreating}
                  className="w-full rounded-xl border border-slate-200/80 bg-slate-50/80 py-3.5 pl-10 pr-4 text-base font-black text-slate-900 outline-none transition-all focus:border-[#0c9de8] focus:bg-white focus:ring-4 focus:ring-[#0c9de8]/10 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Select Network</label>
              <div className="max-h-[248px] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {depositNetworks.map((net) => (
                  <button
                    key={net.id}
                    onClick={() => {
                      const webapp = getTelegramWebApp();
                      if (webapp) webapp.HapticFeedback?.selectionChanged();
                      setNetwork(net.id);
                    }}
                    disabled={!!pendingDeposit || isCreating}
                    title={`${net.name} on ${net.chain}`}
                    className={cn(
                      "relative flex min-h-14 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 pr-5 text-left transition-all active:scale-[0.98]",
                      network === net.id
                        ? "border-[#0c9de8] bg-blue-50/80 text-[#0c9de8] shadow-sm ring-1 ring-[#0c9de8]/20"
                        : "border-slate-200 bg-slate-50/80 text-slate-500 hover:border-slate-300 hover:bg-slate-100"
                    )}
                  >
                    <span className="relative h-8 w-8 shrink-0">
                      <Image
                        src={net.logo}
                        alt={`${net.currency} logo`}
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-full object-contain shadow-sm"
                      />
                      {net.networkLogo !== net.logo && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200">
                          <Image
                            src={net.networkLogo}
                            alt={`${net.chain} network`}
                            width={14}
                            height={14}
                            className="h-full w-full rounded-full object-contain"
                          />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-black uppercase leading-tight text-slate-800">{net.currency}</span>
                      <span className="mt-0.5 block truncate text-[9px] font-bold uppercase leading-tight text-slate-400">{net.chain}</span>
                    </span>
                    {network === net.id && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#0c9de8]" />}
                  </button>
                ))}
                </div>
              </div>
            </div>

            {pendingDeposit ? (
              <div className="p-5 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 shadow-sm shadow-amber-100/50">
                <AlertCircle className="text-amber-500 shrink-0" size={20} />
                <div className="space-y-1.5">
                  <p className="text-xs font-black text-amber-900 uppercase">Pending Invoice Found</p>
                  <p className="text-[10px] font-bold text-amber-700 leading-relaxed opacity-90">
                    You already have a pending deposit of ${pendingDeposit.amount}. Please complete or wait for it to expire.
                  </p>
                  <button
                    onClick={() => {
                      const webapp = getTelegramWebApp();
                      if (webapp) webapp.HapticFeedback?.impactOccurred('light');
                      setViewingDeposit(pendingDeposit);
                      setIsPaying(false);
                    }}
                    className="text-[10px] font-black text-amber-900 uppercase underline pt-1 hover:text-amber-800 transition-colors"
                  >
                    View Pending Invoice
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleCreate}
                disabled={!amount || parseFloat(amount) < minDeposit || isCreating}
                className="w-full py-4 mt-2 bg-[#0c9de8] text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-lg shadow-[#0c9de8]/30 hover:shadow-[#0c9de8]/40 active:scale-[0.98]"
              >
                {isCreating ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                {isCreating ? "Creating..." : "Create Deposit"}
              </button>
            )}
          </div>
        </div>

        {/* History Section */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Deposits</h3>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100/80 p-1 rounded-xl border border-slate-200/50">
                {["all", "paid", "canceled"].map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      const webapp = getTelegramWebApp();
                      if (webapp) webapp.HapticFeedback?.selectionChanged();
                      setActiveFilter(f);
                    }}
                    className={cn(
                      "px-4 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all",
                      activeFilter === f ? "bg-white text-[#0c9de8] shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="py-20 flex flex-col items-center gap-4 bg-white rounded-3xl border border-slate-200/60 shadow-sm">
              <Loader2 className="animate-spin text-[#0c9de8]" size={32} />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Syncing History...</p>
            </div>
          ) : paginatedDeposits.length === 0 ? (
            <div className="bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200 py-20 text-center space-y-4">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto text-slate-300 shadow-sm border border-slate-100">
                <Wallet size={32} />
              </div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No deposits found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedDeposits.map((deposit) => {
                const info = getStatusInfo(deposit.status);
                return (
                  <button
                    key={deposit.id}
                    onClick={() => {
                      const webapp = getTelegramWebApp();
                      if (webapp) webapp.HapticFeedback?.impactOccurred('light');
                      setViewingDeposit(deposit);
                      setIsPaying(false);
                    }}
                    className="w-full bg-white border border-slate-200/60 rounded-[2rem] p-5 flex items-center gap-4 transition-all text-left shadow-sm hover:shadow-md hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-100 group"
                  >
                    <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border transition-colors", info.bg, info.color, `border-${info.color.split('-')[1]}-100`, "group-hover:scale-105")}>
                      <info.icon size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-black text-slate-900 uppercase text-base">${deposit.amount}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {new Date(deposit.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-opacity-50", info.bg, info.color)}>{info.label}</span>
                        <span className="w-1 h-1 bg-slate-300 rounded-full" />
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight truncate">
                          {deposit.network} • {deposit.track_id}
                        </span>
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#0c9de8] group-hover:text-white transition-colors">
                      <ArrowRight size={16} />
                    </div>
                  </button>
                );
              })}

              {hasMore && (
                <button
                  onClick={() => {
                    const webapp = getTelegramWebApp();
                    if (webapp) webapp.HapticFeedback?.impactOccurred('light');
                    setLimit(prev => prev + 10);
                  }}
                  className="w-full py-4 bg-slate-50 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
                >
                  Load More Deposits
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Deposit Details Bottom Sheet (Basic Info Only) */}
      <AnimatePresence>
        {viewingDeposit && !isPaying && (
          <div className="fixed inset-0 z-[500] flex items-end justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingDeposit(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full max-w-[500px] bg-white rounded-t-3xl sm:rounded-3xl p-8 pb-10 overflow-hidden"
            >
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-slate-200 rounded-full" />

              <div className="space-y-6 mt-4">
                <div className="text-center space-y-1">
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Deposit Receipt</h3>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Track ID: {viewingDeposit.track_id}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Amount</p>
                    <p className="text-sm font-black text-slate-900">${viewingDeposit.amount}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Status</p>
                    <p className={cn("text-sm font-black uppercase", getStatusInfo(viewingDeposit.status).color)}>
                      {viewingDeposit.status}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Network</p>
                    <p className="text-sm font-black text-slate-900 uppercase">{viewingDeposit.network}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Date</p>
                    <p className="text-sm font-black text-slate-900">
                      {new Date(viewingDeposit.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  {["pending", "waiting", "paying"].includes(viewingDeposit.status) && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setIsPaying(true)}
                        className="flex-1 py-4 bg-[#0c9de8] text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                      >
                        <DollarSign size={20} /> Pay
                      </button>
                      
                      {viewingDeposit.status !== "paying" && (
                        <button
                          disabled={isCanceling}
                          onClick={() => setShowCancelConfirm(true)}
                          className="flex-1 py-4 bg-red-50 text-red-500 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                        >
                          {isCanceling ? <Loader2 className="animate-spin" size={20} /> : <XCircle size={20} />}
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      const webapp = getTelegramWebApp();
                      if (webapp) webapp.HapticFeedback?.impactOccurred('light');
                      setViewingDeposit(null);
                    }}
                    className="w-full py-4 bg-slate-50 text-slate-900 rounded-2xl font-black uppercase tracking-widest transition-all"
                  >
                    Close Receipt
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={() => {
          if (viewingDeposit) handleCancel(viewingDeposit.track_id);
          setShowCancelConfirm(false);
        }}
        title="Cancel Deposit?"
        message="Are you sure you want to cancel this deposit? This action cannot be undone."
        confirmBtnText="Yes, Cancel"
        confirmBtnVariant="danger"
        isLoading={isCanceling}
      />      {/* Full Screen Payment View */}
      <AnimatePresence>
        {isPaying && viewingDeposit && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 top-16 z-[550] bg-white flex flex-col h-[calc(100vh-64px)]"
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="text-center space-y-2 pb-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                  <Clock size={12} />
                  <span className="text-[10px] font-black uppercase tracking-widest">{timeLeft || "Checking..."}</span>
                </div>
                <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Complete Payment</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Order ID: {viewingDeposit.order_id}
                </p>
              </div>

              <div className="bg-slate-50 rounded-3xl p-6 space-y-6 border border-slate-100">
                <div className="text-center space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Send Exactly</p>
                  <p className="text-3xl font-black text-slate-900">{viewingDeposit.pay_amount} {viewingDeposit.pay_currency}</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2 text-center">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Network</label>
                    <div className="p-3 bg-white rounded-2xl border border-slate-100 font-black text-[#0c9de8] text-lg">
                      {viewingDeposit.network}
                    </div >
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Deposit Address</label>
                    <div className="relative">
                      <div className="p-4 bg-white rounded-2xl border border-slate-100 font-bold text-slate-900 text-xs break-all pr-14 leading-relaxed">
                        {viewingDeposit.address}
                      </div>
                      <button
                        onClick={() => copyToClipboard(viewingDeposit.address)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center transition-all"
                      >
                        {copied ? <Check size={20} /> : <Copy size={20} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-blue-50/50 rounded-2xl text-blue-600 border border-blue-100/50">
                  <Info size={20} className="shrink-0" />
                  <p className="text-[9px] font-bold leading-relaxed">
                    Transfer the exact amount above to the address. Your balance will update automatically after confirmation.
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => handleCheckStatus(viewingDeposit.track_id)}
                    disabled={isChecking}
                    className="w-full py-3.5 bg-[#0c9de8] text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-50 transition-all"
                  >
                    {isChecking ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                    {isChecking ? "Checking..." : "I Have Paid"}
                  </button>

                  {statusMessage && (
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest"
                    >
                      {statusMessage}
                    </motion.p>
                  )}
                </div>
              </div>

              <div className="text-center pt-2">
                <button
                  onClick={() => {
                    const webapp = getTelegramWebApp();
                    if (webapp) webapp.HapticFeedback?.impactOccurred('light');
                    setIsPaying(false);
                  }}
                  className="text-[10px] font-black text-slate-400 uppercase tracking-widest transition-colors"
                >
                  Go Back to Receipt
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
