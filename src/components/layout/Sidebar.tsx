"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Tv, 
  Wallet, 
  ArrowUpRight, 
  Users, 
  HelpCircle, 
  ArrowLeftRight,
  Menu,
  X,
  PlusCircle,
  Bot,
  Smartphone,
  Store,
  BarChart3,
  Code2,
  Lightbulb,
  BriefcaseBusiness
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  type: "publisher" | "advertiser";
  isOpen: boolean;
  onClose: () => void;
  miniappBetaAccess?: boolean;
}

export default function Sidebar({ type, isOpen, onClose, miniappBetaAccess = false }: SidebarProps) {
  const pathname = usePathname();

  const publisherLinks = [
    { name: "Dashboard", href: "/publisher", icon: LayoutDashboard },
    { name: "My Channels", href: "/publisher/channels", icon: Tv },
    { name: "My Bots", href: "/publisher/bots", icon: Bot },
    ...(miniappBetaAccess ? [{ name: "Mini Apps (Beta)", href: "/publisher/miniapps", icon: Smartphone }] : []),
    { name: "Recommendations", href: "/publisher/recommendations", icon: Lightbulb },
    { name: "Developer Center", href: "/publisher/developer", icon: Code2 },
    { name: "Earnings", href: "/publisher/earnings", icon: Wallet },
    { name: "Withdraw", href: "/publisher/withdraw", icon: ArrowUpRight },
    { name: "Referral", href: "/publisher/referral", icon: Users },
    { name: "FAQs", href: "/publisher/faqs", icon: HelpCircle },
  ];

  const advertiserLinks = [
    { name: "Dashboard", href: "/advertiser", icon: LayoutDashboard },
    { name: "My Campaigns", href: "/advertiser/campaigns", icon: Tv },
    { name: "Intelligence", href: "/advertiser/intelligence", icon: BarChart3 },
    { name: "Recommendations", href: "/advertiser/recommendations", icon: Lightbulb },
    { name: "Marketplace", href: "/advertiser/marketplace", icon: Store },
    { name: "Enterprise", href: "/advertiser/enterprise", icon: BriefcaseBusiness },
    { name: "Create Campaign", href: "/advertiser/campaigns/new", icon: PlusCircle },
    { name: "Deposit Fund", href: "/advertiser/deposit", icon: Wallet },
    { name: "FAQs", href: "/advertiser/faqs", icon: HelpCircle },
  ];

  const links = type === "publisher" ? publisherLinks : advertiserLinks;

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-[90] lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside className={cn(
        "fixed top-0 left-0 bottom-0 w-64 bg-[#0c9de8] border-r border-[#0c9de8] z-[100] transition-transform duration-300 lg:translate-x-0 flex flex-col shadow-xl lg:shadow-none",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="px-6 py-6 space-y-1">
          <p className="text-xl font-black text-white tracking-tight">
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </p>
          <p className="text-[10px] font-bold text-blue-100 uppercase tracking-widest opacity-80">
            Dashboard
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-white/20 text-white" 
                    : "text-blue-50 hover:bg-white/10 hover:text-white"
                )}
              >
                <link.icon size={18} />
                {link.name}
              </Link>
            );
          })}
        </div>

        {/* Switcher at bottom */}
        <div className="p-4 border-t border-white/10">
          <Link
            href={type === "publisher" ? "/advertiser" : "/publisher"}
            className="flex items-center justify-between w-full px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors group"
          >
            <div className="flex flex-col items-start">
              <span className="text-[10px] uppercase tracking-wider text-blue-100 font-bold">Switch to</span>
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
