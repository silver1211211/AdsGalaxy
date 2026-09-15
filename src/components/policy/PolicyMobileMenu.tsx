"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import PolicyNav from "@/components/policy/PolicyNav";

export default function PolicyMobileMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden" aria-label="Open policy menu" aria-expanded={open}>
        <Menu size={20} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close policy menu" />
          <aside className="absolute inset-y-0 right-0 z-10 flex h-dvh w-full max-w-[360px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl min-[420px]:w-[360px]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div><p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">AdsGalaxy</p><p className="text-sm font-black text-slate-900">Policy Center</p></div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600" aria-label="Close policy menu"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5"><PolicyNav onNavigate={() => setOpen(false)} /></div>
          </aside>
        </div>
      )}
    </>
  );
}
