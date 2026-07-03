import Link from "next/link";
import { Bot, Code2, Megaphone, Smartphone, Tv } from "lucide-react";

const groups = [
  { title: "Publisher Guides", description: "Learn how to monetize channels, Mini Apps, and bots with AdsGalaxy.", href: "/docs/publisher", items: [
    { href: "/docs/publisher/channels", label: "Channel monetization", icon: Tv },
    { href: "/docs/publisher/miniapps", label: "Mini App monetization", icon: Smartphone },
    { href: "/docs/publisher/bots", label: "Bot monetization", icon: Bot },
  ]},
  { title: "Advertiser Guides", description: "Create campaigns for channels, Mini Apps, and bot broadcasts.", href: "/docs/advertiser", items: [
    { href: "/docs/advertiser/channels", label: "Channel advertising", icon: Tv },
    { href: "/docs/advertiser/miniapps", label: "Mini App advertising", icon: Smartphone },
    { href: "/docs/advertiser/bots", label: "Bot advertising", icon: Megaphone },
  ]},
  { title: "Developer Platform", description: "Integrate AdsGalaxy into Mini Apps, bots, websites, mobile apps, and future platforms.", href: "/docs/developers", items: [
    { href: "/docs/developers#quick-start", label: "Quick Start", icon: Code2 },
    { href: "/docs/developers#integration-id", label: "Integration ID", icon: Smartphone },
    { href: "/docs/developers#analytics", label: "Analytics", icon: Bot },
  ]},
];

export default function DocsHomePage() {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">AdsGalaxy Documentation</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Build, monetize, and advertise with confidence.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Practical guides for publishers and advertisers using AdsGalaxy across Telegram channels, Mini Apps, and bots.</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">{group.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{group.description}</p>
            <div className="mt-5 space-y-2">
              {group.items.map((item) => <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm font-bold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"><item.icon size={18} />{item.label}</Link>)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
