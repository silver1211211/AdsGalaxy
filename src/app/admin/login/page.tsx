"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, User, Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }

      router.push("/admin");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-black tracking-tight text-slate-900 uppercase">
          Admin Portal
        </h2>
        <p className="mt-2 text-center text-sm font-bold text-slate-500 uppercase tracking-widest">
          Sign in to manage AdsFusion
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl shadow-slate-200/50 sm:rounded-[2.5rem] sm:px-10 border border-slate-100">
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm font-bold text-center border border-red-100">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-black text-slate-600 uppercase tracking-widest px-1 mb-2">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200/60 rounded-2xl focus:border-[#0c9de8] focus:bg-white outline-none font-bold text-slate-900 transition-all"
                  placeholder="admin"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-600 uppercase tracking-widest px-1 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200/60 rounded-2xl focus:border-[#0c9de8] focus:bg-white outline-none font-bold text-slate-900 transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-4 px-4 border border-transparent rounded-2xl shadow-lg shadow-[#0c9de8]/30 text-sm font-black uppercase tracking-widest text-white bg-[#0c9de8] hover:bg-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {isLoading ? <Loader2 className="animate-spin" size={20} /> : "Sign In"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
