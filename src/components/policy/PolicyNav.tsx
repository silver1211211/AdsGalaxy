"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BookOpen, Megaphone, Smartphone, TrendingUp, Tv } from "lucide-react";

const sections = [
  {
    title: "Publisher",
    links: [
      { href: "/policy#publisher-policy", path: "/policy", label: "Overview", icon: BookOpen, activeOnHome: true },
      { href: "/policy/publisher", path: "/policy/publisher", label: "General Policy", icon: BookOpen },
      { href: "/policy/publisher/channel", path: "/policy/publisher/channel", label: "Channel Policy", icon: Tv },
      { href: "/policy/publisher/bot", path: "/policy/publisher/bot", label: "Bot Policy", icon: Bot },
      { href: "/policy/publisher/mini-app", path: "/policy/publisher/mini-app", label: "Mini App Policy", icon: Smartphone },
    ],
  },
  {
    title: "Advertiser",
    links: [
      { href: "/policy#advertiser-policy", path: "/policy", label: "Overview", icon: Megaphone },
      { href: "/policy/advertiser", path: "/policy/advertiser", label: "General Policy", icon: Megaphone },
      { href: "/policy/advertiser/channel", path: "/policy/advertiser/channel", label: "Channel Campaign Policy", icon: Tv },
      { href: "/policy/advertiser/channel-growth", path: "/policy/advertiser/channel-growth", label: "Channel Growth Policy", icon: TrendingUp },
      { href: "/policy/advertiser/teaser", path: "/policy/advertiser/teaser", label: "Teaser Campaign Policy", icon: Megaphone },
      { href: "/policy/advertiser/mini-app", path: "/policy/advertiser/mini-app", label: "Mini App Campaign Policy", icon: Smartphone },
      { href: "/policy/advertiser/bot", path: "/policy/advertiser/bot", label: "Bot Campaign Policy", icon: Bot },
    ],
  },
] as const;

export default function PolicyNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6" aria-label="Policy sections">
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <p className="px-3 text-[10px] font-black uppercase tracking-widest text-slate-400">{section.title}</p>
          <div className="space-y-1">
            {section.links.map((link) => {
              const active = pathname === link.path && (link.path !== "/policy" || "activeOnHome" in link);
              return (
                <Link key={link.href} href={link.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition-colors ${active ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"}`}>
                  <link.icon size={16} className="shrink-0" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
