import React from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Hammer } from "lucide-react";

interface ComingSoonProps {
  title: string;
  type: "publisher" | "advertiser";
}

export default function ComingSoon({ title, type }: ComingSoonProps) {
  return (
    <DashboardLayout type={type}>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
        <div className="w-20 h-20 bg-blue-100 rounded-3xl flex items-center justify-center text-blue-600 animate-pulse">
          <Hammer size={40} />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
          <p className="text-slate-500 max-w-md mx-auto">
            This feature is currently under development. We're working hard to get it ready for you!
          </p>
        </div>
        <div className="pt-4">
          <div className="inline-flex items-center px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-bold border border-blue-100">
            Work in Progress
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
