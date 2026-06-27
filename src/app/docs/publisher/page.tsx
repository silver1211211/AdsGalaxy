import Link from "next/link";
import { Bot, Smartphone, Tv } from "lucide-react";

const cards = [
  { href: "/docs/publisher/channels", title: "Channel Monetization", description: "Add Telegram channels, set posting times, pass review, and earn from approved ads.", icon: Tv },
  { href: "/docs/publisher/miniapps", title: "Mini App Monetization", description: "Submit Mini Apps, complete beta requirements, and track approved AdsGalaxy performance.", icon: Smartphone },
  { href: "/docs/publisher/bots", title: "Bot Monetization", description: "Connect bots, grow eligible users, and earn from broadcast delivery.", icon: Bot },
];

export default function PublisherDocsPage() {
  return (
    <div className="space-y-6">
      <section id="overview" className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">Publisher</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Monetize your Telegram audience</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          AdsGalaxy helps approved publishers earn from channels, Mini Apps, and bots while keeping review and reporting in one place.
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
