"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyCodeBlock({ code, language = "ts" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{language}</span>
        <button onClick={copyCode} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/15">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-6 text-blue-50"><code>{code}</code></pre>
    </div>
  );
}
