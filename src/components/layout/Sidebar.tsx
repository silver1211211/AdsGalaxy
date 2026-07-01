"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Tv,
  Wallet,
  ArrowUpRight,
  Users,
  HelpCircle,
  ArrowLeftRight,
  BriefcaseBusiness,
  DollarSign,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  type: "publisher" | "advertiser";
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ type, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const publisherLinks = [
    { name: "Dashboard", href: "/publisher", icon: LayoutDashboard },
    { name: "Monetize", href: "/publisher/monetize", icon: DollarSign },
    { name: "Earnings", href: "/publisher/earnings", icon: Wallet },
    { name: "Withdraw", href: "/publisher/withdraw", icon: ArrowUpRight },
    { name: "Referral", href: "/publisher/referral", icon: Users },
    { name: "FAQs", href: "/publisher/faqs", icon: HelpCircle },
  ];

  const advertiserLinks = [
    { name: "Dashboard", href: "/advertiser", icon: LayoutDashboard },
    { name: "Campaigns", href: "/advertiser/campaigns", icon: Tv },
    { name: "Enterprise", href: "/advertiser/enterprise", icon: BriefcaseBusiness },
    { name: "Deposit Fund", href: "/advertiser/deposit", icon: Wallet },
    { name: "FAQs", href: "/advertiser/faqs", icon: HelpCircle },
  ];

  const links = type === "publisher" ? publisherLinks : advertiserLinks;

  useEffect(() => {
    links.forEach((link) => router.prefetch(link.href));
  }, [links, router]);

  const handleNavigation = () => {
    onClose();
    window.dispatchEvent(new Event("adsgalaxy:navigation-start"));
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside className={cn(
        "fixed bottom-0 left-0 top-0 z-[100] flex w-64 flex-col overflow-hidden border-r border-white/15 bg-[#0c9de8] shadow-2xl shadow-blue-950/20 transition-transform duration-300 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.10),transparent_45%)] lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="relative px-5 py-6">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4 shadow-inner shadow-white/5 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#0c9de8] shadow-sm">
                <Sparkles size={19} />
              </div>
              <div>
                <p className="text-lg font-black tracking-tight text-white">
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-100/80">
                  Command Center
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                onClick={handleNavigation}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold transition-all",
                  isActive
                    ? "bg-white text-[#0c9de8] shadow-lg shadow-blue-950/10"
                    : "text-blue-50 hover:bg-white/10 hover:text-white"
                )}
              >
                <span className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
                  isActive ? "bg-blue-50 text-[#0c9de8]" : "bg-white/10 text-white group-hover:bg-white/15"
                )}>
                  <link.icon size={16} />
                </span>
                {link.name}
              </Link>
            );
          })}
        </div>

        {/* Switcher at bottom */}
        <div className="relative border-t border-white/10 p-4">
          <Link
            href={type === "publisher" ? "/advertiser" : "/publisher"}
            onClick={handleNavigation}
            className="group flex w-full items-center justify-between rounded-2xl border border-white/15 bg-white/10 px-4 py-3 shadow-inner shadow-white/5 transition-colors hover:bg-white/20"
          >
            <div className="flex flex-col items-start">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-100">Switch to</span>
              <span className="text-sm font-semibold text-white capitalize">
                {type === "publisher" ? "Advertiser" : "Publisher"}
              </span>
            </div>
            <ArrowLeftRight size={18} className="text-blue-100 group-hover:text-white transition-colors" />
          </Link>
        </div>
      </aside>
    </>
  );
}
