import Link from "next/link";
import { Bot, Smartphone, Tv } from "lucide-react";

const cards = [
  { href: "/docs/advertiser/channels", title: "Channel Advertising", description: "Run view or click campaigns in approved Telegram channels.", icon: Tv },
  { href: "/docs/advertiser/miniapps", title: "Mini App Advertising", description: "Create Mini App campaigns and track spend safely.", icon: Smartphone },
  { href: "/docs/advertiser/bots", title: "Bot Advertising", description: "Reach bot audiences through approved broadcast campaigns.", icon: Bot },
];

export default function AdvertiserDocsPage() {
  return (
    <div className="space-y-6">
      <section id="overview" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">Advertiser</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Advertise across Telegram surfaces</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          Use AdsGalaxy to create channel, Mini App, and bot campaigns with approval, delivery, and reporting handled in one advertiser dashboard.
        </p>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-200">
            <card.icon className="text-[#0c9de8]" size={24} />
            <h2 className="mt-4 text-base font-black text-slate-900">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
