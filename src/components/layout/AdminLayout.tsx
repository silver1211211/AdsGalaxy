"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Megaphone, Tv, CreditCard, Wallet, Activity, HelpCircle, Settings, LogOut, Menu, X, Bot, Moon, Sun, Radio, ShieldCheck, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

const menuItems = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/campaigns", icon: Megaphone, label: "Campaigns" },
  { href: "/admin/miniapp-rewarded", icon: Smartphone, label: "Mini App Ads" },
  { href: "/admin/channels", icon: Tv, label: "Channels" },
  { href: "/admin/bots", icon: Bot, label: "Bots" },
  { href: "/admin/miniapps", icon: Smartphone, label: "Mini Apps" },
  { href: "/admin/withdrawals", icon: CreditCard, label: "Withdrawals" },
  { href: "/admin/deposits", icon: Wallet, label: "Deposits" },
  { href: "/admin/audits", icon: Activity, label: "Views Audit" },
  { href: "/admin/broadcasts", icon: Radio, label: "Broadcast Audit" },
  { href: "/admin/availability", icon: ShieldCheck, label: "Availability Checker" },
  { href: "/admin/faqs", icon: HelpCircle, label: "Manage FAQs" },
  { href: "/admin/settings", icon: Settings, label: "System Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [theme, setTheme] = useState<string>("theme-arctic");
  const [tempTheme, setTempTheme] = useState<string>("theme-arctic");
  const [useCustomCursor, setUseCustomCursor] = useState<boolean>(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const themes = [
    // 🌑 DARK THEMES
    { id: 'theme-midnight', name: 'Midnight Eclipse', type: 'dark', accent: '#6366F1', bg: '#0A0A0F' },
    { id: 'theme-obsidian', name: 'Crimson Void', type: 'dark', accent: '#E11D48', bg: '#050507' },
    { id: 'theme-emerald', name: 'Cyber Emerald', type: 'dark', accent: '#10B981', bg: '#0B1110' },
    { id: 'theme-purple', name: 'Vivid Violet', type: 'dark', accent: '#C026D3', bg: '#0F0817' },
    { id: 'theme-amoled', name: 'Pure AMOLED', type: 'dark', accent: '#3B82F6', bg: '#000000' },
    { id: 'theme-midnight-stark', name: 'Midnight Stark', type: 'dark', accent: '#FACC15', bg: '#000000' },
    
    // ☀️ LIGHT THEMES
    { id: 'theme-arctic', name: 'Snow Frost', type: 'light', accent: '#3B82F6', bg: '#F8FAFC' },
    { id: 'theme-arctic-stark', name: 'Arctic Stark', type: 'light', accent: '#0000FF', bg: '#FFFFFF' },
    { id: 'theme-sand', name: 'Desert Sand', type: 'light', accent: '#EA580C', bg: '#FFF9F0' },
    { id: 'theme-sage', name: 'Mint Fresh', type: 'light', accent: '#16A34A', bg: '#F6F9F6' },
    { id: 'theme-sakura', name: 'Rose Petal', type: 'light', accent: '#EC4899', bg: '#FFF7F9' },
    { id: 'theme-cloud', name: 'Steel Blue', type: 'light', accent: '#0EA5E9', bg: '#F1F5F9' },
  ];

  useEffect(() => {
    const savedTheme = localStorage.getItem("admin_theme_v2");
    if (savedTheme) {
      setTheme(savedTheme);
      setTempTheme(savedTheme);
    }
    const savedCursor = localStorage.getItem("admin_custom_cursor");
    if (savedCursor === "true") setUseCustomCursor(true);

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const handleApplyTheme = () => {
    setTheme(tempTheme);
    localStorage.setItem("admin_theme_v2", tempTheme);
    localStorage.setItem("admin_custom_cursor", useCustomCursor.toString());
    setIsThemeModalOpen(false);
  };

  useEffect(() => {
    const hasAuth = document.cookie.includes("admin_auth=");
    if (!hasAuth && pathname !== "/admin/login") {
      router.push("/admin/login");
    } else {
      setIsAuthenticated(true);
    }

    // Global fetch interceptor to catch 401 Unauthorized API responses
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401) {
        document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = "/admin/login";
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [pathname, router]);

  const handleLogout = () => {
    document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    router.push("/admin/login");
  };

  if (!isAuthenticated && pathname !== "/admin/login") return null;

  return (
    <div id="admin-root" className={cn(
      "min-h-screen font-sans flex text-sm transition-all duration-300 admin-panel",
      theme
    )}>
      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Confirm Logout</h3>
            <p className="text-sm text-slate-600 mb-6">Are you sure you want to securely log out of the admin panel?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2 text-slate-600 border border-slate-200 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogout}
                className="flex-1 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors cursor-pointer"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Theme Selection Modal */}
      {isThemeModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in zoom-in-95 duration-300">
          <div className={cn("bg-white rounded-2xl sm:rounded-3xl w-full max-w-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] admin-panel", tempTheme)}>
            <div className="px-5 sm:px-8 py-5 sm:py-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Appearance</h3>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">Customize your administrative workspace</p>
              </div>
              <button onClick={() => setIsThemeModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors cursor-pointer text-slate-400">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 sm:p-8 overflow-y-auto space-y-8">
              {/* Dark Themes Group */}
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-1.5 rounded-lg bg-slate-900 text-white"><Moon size={14} /></div>
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Dark Modes</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {themes.filter(t => t.type === 'dark').map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTempTheme(t.id)}
                      className={cn(
                        "group p-3 sm:p-4 rounded-xl border-2 text-left transition-all cursor-pointer relative overflow-hidden bg-white/5",
                        tempTheme === t.id ? "border-blue-500 ring-4 ring-blue-500/10" : "border-slate-100 hover:border-slate-200"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-bold text-slate-900 text-xs sm:text-sm">{t.name}</span>
                        {tempTheme === t.id && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                      </div>
                      <div className="flex gap-1.5 h-6">
                        <div className="flex-1 rounded-md border border-slate-200/20" style={{ backgroundColor: t.bg }} />
                        <div className="w-8 rounded-md" style={{ backgroundColor: t.accent }} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Light Themes Group */}
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-1.5 rounded-lg bg-amber-100 text-amber-600"><Sun size={14} /></div>
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Light Modes</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {themes.filter(t => t.type === 'light').map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTempTheme(t.id)}
                      className={cn(
                        "group p-3 sm:p-4 rounded-xl border-2 text-left transition-all cursor-pointer relative overflow-hidden bg-white/5",
                        tempTheme === t.id ? "border-blue-500 ring-4 ring-blue-500/10" : "border-slate-100 hover:border-slate-200"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-bold text-slate-900 text-xs sm:text-sm">{t.name}</span>
                        {tempTheme === t.id && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                      </div>
                      <div className="flex gap-1.5 h-6">
                        <div className="flex-1 rounded-md border border-slate-200/10" style={{ backgroundColor: t.bg }} />
                        <div className="w-8 rounded-md" style={{ backgroundColor: t.accent }} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </div>
            
            <div className="px-5 sm:px-8 py-4 sm:py-5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-center sticky bottom-0 z-10">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setUseCustomCursor(!useCustomCursor)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer",
                    useCustomCursor ? "bg-blue-600" : "bg-slate-200"
                  )}
                >
                  <span className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    useCustomCursor ? "translate-x-6" : "translate-x-1"
                  )} />
                </button>
                <span className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-tight">Apply Custom Cursor</span>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsThemeModalOpen(false)}
                  className="flex-1 sm:flex-none px-6 py-2 sm:py-2.5 text-slate-600 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleApplyTheme}
                  className="flex-1 sm:flex-none px-8 py-2 sm:py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Cursor Follower */}
      {useCustomCursor && (
        <div 
          className="fixed pointer-events-none z-[9999] custom-cursor-wrapper hidden lg:block"
          style={{ 
            left: mousePos.x, 
            top: mousePos.y,
            transform: 'translate(-50%, -50%)' 
          }}
        >
          <div className="w-8 h-8 rounded-full border-2 border-[var(--admin-accent)] opacity-30 animate-pulse scale-110" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--admin-accent)] shadow-[0_0_10px_var(--admin-accent)]" />
          </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:sticky top-0 h-screen w-56 bg-white border-r border-slate-200 z-50 transition-transform duration-300 flex flex-col",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200">
          <span className="font-semibold text-slate-800">AdsFusion Admin</span>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-slate-600 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {menuItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md font-medium text-xs transition-colors cursor-pointer sidebar-item",
                  isActive && "sidebar-item-active"
                )}
                onClick={() => setIsSidebarOpen(false)}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-3">
          <button
            onClick={() => setIsThemeModalOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-bold text-xs bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all border border-slate-200/50 cursor-pointer group"
          >
            <div className="p-1.5 rounded-lg bg-white shadow-sm border border-slate-200 group-hover:scale-110 transition-transform">
              <Sun size={14} className="text-blue-500" />
            </div>
            Change Theme
          </button>

          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md font-medium text-xs text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4 sticky top-0 z-30">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1 flex items-center text-sm text-slate-600">
            <span className="text-slate-400 mr-2">/</span>
            {menuItems.find(i => pathname === i.href || (i.href !== "/admin" && pathname?.startsWith(i.href)))?.label || "Overview"}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
