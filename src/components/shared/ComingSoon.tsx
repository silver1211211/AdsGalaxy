import DashboardLayout from "@/components/layout/DashboardLayout";
import { Hammer, Sparkles } from "lucide-react";

interface ComingSoonProps {
  title: string;
  type: "publisher" | "advertiser";
}

export default function ComingSoon({ title, type }: ComingSoonProps) {
  return (
    <DashboardLayout type={type}>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="relative w-full overflow-hidden rounded-[2rem] border border-blue-100 bg-white p-8 shadow-xl shadow-blue-100/50">
          <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[#0c9de8]/15 blur-3xl" />
          <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-50 text-[#0c9de8] shadow-inner">
            <Hammer size={40} />
          </div>
          <div className="relative space-y-2">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#0c9de8]">
              <Sparkles size={12} />
              Premium module
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">{title}</h1>
            <p className="text-slate-500 max-w-md mx-auto">
            This feature is currently under development. We're working hard to get it ready for you!
            </p>
          </div>
          <div className="relative pt-6">
            <div className="inline-flex items-center px-4 py-2 bg-[#0c9de8] text-white rounded-full text-sm font-bold shadow-lg shadow-[#0c9de8]/25">
              Work in Progress
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
