"use client";

import { useHeader } from "@/context/HeaderContext";
import { Menu } from "lucide-react";

interface HeaderProps {
  toggleSidebar: () => void;
}

export default function Header({ toggleSidebar }: HeaderProps) {
  const { title } = useHeader();

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-[#0c9de8] border-b border-[#0c9de8] z-[60] flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="p-2 hover:bg-white/10 rounded-lg lg:hidden text-white"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-white">{title}</span>
        </div>
      </div>
    </header>
  );
}
