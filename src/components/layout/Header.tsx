"use client";

import { useHeader } from "@/context/HeaderContext";
import { Menu, Sparkles } from "lucide-react";

interface HeaderProps {
  toggleSidebar: () => void;
}

export default function Header({ toggleSidebar }: HeaderProps) {
  const { title } = useHeader();

  return (
    <header className="fixed left-0 right-0 top-0 z-[60] flex h-16 items-center justify-between border-b border-white/20 bg-[#0c9de8]/90 px-4 shadow-lg shadow-blue-950/10 backdrop-blur-xl lg:px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="rounded-xl border border-white/15 bg-white/10 p-2 text-white shadow-sm transition active:scale-95 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div className="hidden h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white sm:flex">
            <Sparkles size={17} />
          </div>
          <div>
            <span className="block text-lg font-black tracking-tight text-white">{title}</span>
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/80 sm:block">AdsGalaxy Mini App</span>
          </div>
        </div>
      </div>
    </header>
  );
}
