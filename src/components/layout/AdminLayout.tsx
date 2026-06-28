"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  BriefcaseBusiness,
  Code2,
  CreditCard,
  FileText,
  Gift,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Power,
  Radar,
  Radio,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Smartphone,
  Trophy,
  Tv,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const menuSections = [
  {
    label: null,
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { href: "/admin/users", icon: Users, label: "Users" },
      { href: "/admin/channels", icon: Tv, label: "Channels" },
      { href: "/admin/bots", icon: Bot, label: "Bots" },
      { href: "/admin/miniapps", icon: Smartphone, label: "Mini Apps" },
      { href: "/admin/campaigns", icon: Megaphone, label: "Campaigns" },
      { href: "/admin/miniapp-rewarded", icon: Zap, label: "Rewarded Ads" },
    ],
  },
  {
    label: "PAYMENTS",
    items: [
      { href: "/admin/withdrawals", icon: CreditCard, label: "Withdrawals" },
      { href: "/admin/deposits", icon: Wallet, label: "Deposits" },
    ],
  },
  {
    label: "TRUST & SAFETY",
    items: [
      { href: "/admin/traffic-quality", icon: Radar, label: "Traffic Quality" },
      { href: "/admin/revenue-protection", icon: ShieldAlert, label: "Revenue Protection" },
      { href: "/admin/automation", icon: ShieldCheck, label: "Moderation Rules" },
    ],
  },
  {
    label: "GROWTH",
    items: [
      { href: "/admin/referrals", icon: Gift, label: "Referrals" },
      { href: "/admin/enterprise", icon: BriefcaseBusiness, label: "Enterprise" },
    ],
  },
  {
    label: "OPTIMIZATION",
    items: [
      { href: "/admin/inventory-optimization", icon: Trophy, label: "Inventory Scoring" },
      { href: "/admin/placement-logic", icon: Sliders, label: "Ad Placement Rules" },
    ],
  },
  {
    label: "PLATFORM",
    items: [
      { href: "/admin/developer-platform", icon: Code2, label: "Developer Hub" },
      { href: "/admin/broadcasts", icon: Radio, label: "Broadcasts" },
    ],
  },
  {
    label: "AUDIT LOGS",
    items: [
      { href: "/admin/audits", icon: Activity, label: "View Audit" },
      { href: "/admin/system-logs", icon: FileText, label: "System Logs" },
    ],
  },
  {
    label: "CONFIGURATION",
    items: [
      { href: "/admin/settings", icon: Settings, label: "Platform Settings" },
      { href: "/admin/faqs", icon: HelpCircle, label: "FAQs" },
      { href: "/admin/availability", icon: Server, label: "Service Status" },
      { href: "/admin/production-readiness", icon: Power, label: "System Health" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      if (pathname === "/admin/login") {
        setIsAuthenticated(true);
        return;
      }

      const response = await fetch("/api/admin/session", { cache: "no-store" });
      if (cancelled) return;
      if (!response.ok) {
        router.push("/admin/login");
        return;
      }
      setIsAuthenticated(true);
    };

    checkSession().catch(() => router.push("/admin/login"));

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401) {
        window.location.href = "/admin/login";
      }
      return response;
    };

    return () => {
      cancelled = true;
      window.fetch = originalFetch;
    };
  }, [pathname, router]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    router.push("/admin/login");
  };

  const activeItem = menuSections
    .flatMap((section) => section.items)
    .find((item) => pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href)));

  if (!isAuthenticated && pathname !== "/admin/login") return null;

  return (
    <div id="admin-root" className="admin-panel flex min-h-screen font-sans text-sm transition-all duration-300">
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-bold text-slate-900">Confirm Logout</h3>
            <p className="mb-6 text-sm text-slate-600">Are you sure you want to securely log out of the admin panel?</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 cursor-pointer rounded-md border border-slate-200 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 cursor-pointer rounded-md bg-red-600 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close admin menu"
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 z-50 flex h-screen w-56 flex-col border-r border-slate-200 bg-white transition-transform duration-300 lg:sticky",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="font-semibold text-slate-800">AdsGalaxy Admin</span>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="cursor-pointer text-slate-400 hover:text-slate-600 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {menuSections.map((section, sectionIndex) => (
            <div key={section.label ?? "main"} className={sectionIndex > 0 ? "mt-3" : ""}>
              {section.label && (
                <div className="px-3 pb-1.5 pt-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {section.label}
                  </span>
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "sidebar-item flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                        isActive && "sidebar-item-active"
                      )}
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <item.icon size={16} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="cursor-pointer text-slate-400 hover:text-slate-600 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex flex-1 items-center text-sm text-slate-600">
            <span className="mr-2 text-slate-400">/</span>
            {activeItem?.label || "Overview"}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
