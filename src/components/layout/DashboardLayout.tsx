"use client";

import React, { useState, useEffect } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { Loader2 } from "lucide-react";

interface DashboardLayoutProps {
  children: React.ReactNode;
  type: "publisher" | "advertiser";
}

export default function DashboardLayout({ children, type }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const webapp = (window as any).Telegram?.WebApp;
    if (webapp) {
      webapp.ready();
      webapp.expand();
      // Small delay to ensure initData is populated
      const timer = setTimeout(() => setIsReady(true), 100);
      return () => clearTimeout(timer);
    } else {
      // For local browser testing, we still need to show something
      // but initData will be missing. 
      setIsReady(true);
    }
  }, []);

  // Save dashboard preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("last_dashboard", type);
    }
  }, [type]);

  if (!isReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-[#0c9de8]" size={40} />
        <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar 
        type={type} 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
      />
      
      <main className="lg:pl-64 pt-16 min-h-screen transition-all duration-300">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
