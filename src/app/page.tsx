"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const lastDashboard = localStorage.getItem("last_dashboard");
      if (lastDashboard === "advertiser") {
        router.replace("/advertiser");
      } else {
        router.replace("/publisher");
      }
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-[#0c9de8]" size={40} />
      <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Restoring Session...</p>
    </div>
  );
}
