import Link from "next/link";

const configuredBotUrl = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot"}`;

export function ChannelAdExample() {
  return (
    <div className="rounded-[2rem] border border-slate-800 bg-[#0f1b27] p-4 shadow-sm">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">AdsGalaxy Channel Example Ad</p>
      <div className="overflow-hidden rounded-3xl border border-slate-700 bg-[#172635] shadow-sm">
        <div className="border-b border-slate-700 bg-[#111d29] px-4 py-3">
          <p className="text-sm font-black uppercase tracking-wide text-white">Telegram Channel</p>
          <p className="mt-1 text-xs font-bold text-slate-400">Sponsored post example</p>
        </div>
        <div className="bg-[#213447] px-4 py-2">
          <p className="text-sm font-bold text-[#63b3ff]">Pinned message</p>
          <p className="mt-1 truncate text-sm text-white">Sponsored update from an approved AdsGalaxy campaign</p>
        </div>
        <div>
          <div className="h-44 bg-[radial-gradient(circle_at_20%_20%,#8b5cf6_0%,transparent_28%),linear-gradient(135deg,#050816_0%,#0c1d4a_48%,#0c9de8_100%)]">
            <div className="flex h-full items-end p-5">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-xs font-black uppercase tracking-widest text-cyan-100">Campaign image</p>
                <p className="mt-1 text-lg font-black text-white">Premium Telegram growth tools</p>
              </div>
            </div>
          </div>
          <div className="space-y-4 p-4">
            <p className="text-base leading-7 text-white">
              Launch your Telegram project faster with simple tools for your community.
            </p>
            <ul className="space-y-1 text-sm leading-6 text-slate-100">
              <li>+ Fast setup</li>
              <li>+ Clean dashboard</li>
              <li>+ Built for teams</li>
            </ul>
            <p className="text-sm leading-6 text-white">
              Start building a better Telegram experience today.
              <span className="ml-3 text-slate-400">Views 8&nbsp;&nbsp;1:59 PM</span>
            </p>
            <div className="grid gap-2">
              <button className="rounded-xl bg-[#213447] px-4 py-3 text-sm font-black text-white">Sign Up</button>
              <button className="rounded-xl bg-[#213447] px-4 py-3 text-sm font-black text-white">Advertise with AdsGalaxy</button>
            </div>
            <Watermark />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MiniAppAdExample() {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-4 shadow-sm">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-300">AdsGalaxy Mini App Example Ad</p>
      <div className="rounded-[1.5rem] bg-white p-3 shadow-sm">
        <div className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-sm">
          <div className="h-52 bg-[radial-gradient(circle_at_18%_22%,#8b5cf6_0%,transparent_27%),linear-gradient(135deg,#e0f2fe_0%,#38bdf8_44%,#0f172a_100%)]">
            <div className="flex h-full items-end p-5">
              <div className="w-full rounded-2xl border border-white/20 bg-white/15 p-4 backdrop-blur">
                <p className="text-xs font-black uppercase tracking-widest text-cyan-50">Campaign image</p>
                <p className="mt-2 max-w-sm text-xl font-black leading-tight text-white">A polished product moment inside your Mini App</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="h-12 rounded-xl bg-white/20" />
                  <div className="h-12 rounded-xl bg-white/20" />
                  <div className="h-12 rounded-xl bg-white/20" />
                </div>
              </div>
            </div>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">Sponsored</p>
            <h3 className="mt-2 text-xl font-black text-slate-950">Simplify your next online launch</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Discover a fast, polished product experience designed for Telegram-first audiences.
            </p>
            <button className="mt-4 w-full rounded-xl bg-[#0c9de8] px-4 py-3 text-xs font-black uppercase tracking-widest text-white">Start Now</button>
            <div className="mt-4"><Watermark /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BotAdExample() {
  return (
    <div className="rounded-[2rem] border border-slate-800 bg-[#0f1b27] p-4 shadow-sm">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">AdsGalaxy Bot Example Ad</p>
      <div className="overflow-hidden rounded-3xl border border-slate-700 bg-[#172635] shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-700 bg-[#111d29] px-4 py-3">
          <div className="h-9 w-9 rounded-full bg-[#0c9de8]" />
          <div>
            <p className="text-sm font-black text-white">Telegram Bot</p>
            <p className="text-xs font-bold text-slate-400">Sponsored message example</p>
          </div>
        </div>
        <div className="bg-[#0f1b27] p-4">
          <div className="max-w-[94%] overflow-hidden rounded-[1.35rem] rounded-bl-md bg-[#213447] shadow-sm">
            <div className="h-40 bg-[radial-gradient(circle_at_18%_22%,#8b5cf6_0%,transparent_26%),linear-gradient(135deg,#061020_0%,#0b2a56_46%,#0c9de8_100%)]">
              <div className="flex h-full items-end p-4">
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                  <p className="text-xs font-black uppercase tracking-widest text-cyan-100">Campaign image</p>
                  <p className="mt-1 text-base font-black text-white">Built for Telegram audiences</p>
                </div>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <h3 className="text-lg font-normal text-white">New offer for Telegram users</h3>
              <p className="text-sm leading-6 text-slate-100">
                A concise sponsored message with a clear next step.
              </p>
              <ul className="space-y-1 text-sm leading-6 text-slate-100">
                <li>+ Quick setup</li>
                <li>+ Clean tools</li>
                <li>+ Built for growth</li>
              </ul>
              <p className="text-right text-xs font-bold text-slate-400">1:59 PM</p>
            </div>
            <div className="grid gap-2 border-t border-slate-700 bg-[#172635] p-3">
              <button className="rounded-xl bg-[#263c50] px-4 py-3 text-sm font-black text-white">Sign Up</button>
              <button className="rounded-xl bg-[#263c50] px-4 py-3 text-sm font-black text-white">Visit Website</button>
            </div>
          </div>
          <div className="mt-4"><Watermark /></div>
        </div>
      </div>
    </div>
  );
}

function Watermark() {
  return (
    <Link href={configuredBotUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-[10px] font-black uppercase tracking-widest text-[#0c9de8] hover:text-blue-700">
      Powered by AdsGalaxy
    </Link>
  );
}
