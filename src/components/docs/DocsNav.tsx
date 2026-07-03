import Link from "next/link";
import { BookOpen, Bot, Code2, Megaphone, Smartphone, Tv } from "lucide-react";

const sections = [
  { title: "Publisher", links: [
    { href: "/docs/publisher", label: "Overview", icon: BookOpen },
    { href: "/docs/publisher/channels", label: "Channels", icon: Tv },
    { href: "/docs/publisher/miniapps", label: "Mini Apps", icon: Smartphone },
    { href: "/docs/publisher/bots", label: "Bot Integration", icon: Bot },
  ]},
  { title: "Advertiser", links: [
    { href: "/docs/advertiser", label: "Overview", icon: Megaphone },
    { href: "/docs/advertiser/channels", label: "Channel Ads", icon: Tv },
    { href: "/docs/advertiser/miniapps", label: "Mini App Ads", icon: Smartphone },
    { href: "/docs/advertiser/bots", label: "Bot Ads", icon: Bot },
  ]},
  { title: "Developers", links: [{ href: "/docs/developers", label: "Developer API", icon: Code2 }] },
];

export default function DocsNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-6">
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <p className="px-3 text-[10px] font-black uppercase tracking-widest text-slate-400">{section.title}</p>
          <div className="space-y-1">
            {section.links.map((link) => <Link key={link.href} href={link.href} onClick={onNavigate} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-600"><link.icon size={16} />{link.label}</Link>)}
          </div>
        </div>
      ))}
    </nav>
  );
}
