"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole } from "lucide-react";

export default function SilverLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/check/silver/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Login failed");
      router.replace("/check/silver"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Login failed"); }
    finally { setLoading(false); }
  };
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-4"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-slate-950 p-3 text-white"><LockKeyhole/></span><div><p className="text-xs font-black tracking-[.18em] text-slate-400">PRIVATE CAMPAIGN SCOPE</p><h1 className="text-xl font-black">SILVER ADS CONTROL</h1></div></div><label className="text-xs font-black uppercase text-slate-500">Silver password</label><input autoFocus type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"/><button disabled={loading||!password} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-black text-white disabled:opacity-50">{loading&&<Loader2 size={16} className="animate-spin"/>}Enter Silver Admin</button>{error&&<p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}</form></main>;
}
