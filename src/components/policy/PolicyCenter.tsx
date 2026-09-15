import Link from "next/link";
import { Bot, BookOpen, Megaphone, Smartphone, TrendingUp, Tv } from "lucide-react";
import { policyRulesForScope, type PolicyDefinition } from "@/lib/policyRegistry";

const guideGroups = [
  {
    id: "publisher-policy",
    title: "Publisher Policy",
    description: "Standards for publishers monetizing channels, Mini Apps, and bots with AdsGalaxy.",
    items: [
      { href: "/policy/publisher", label: "General Policy", icon: BookOpen },
      { href: "/policy/publisher/channel", label: "Channel Policy", icon: Tv },
      { href: "/policy/publisher/bot", label: "Bot Policy", icon: Bot },
      { href: "/policy/publisher/mini-app", label: "Mini App Policy", icon: Smartphone },
    ],
  },
  {
    id: "advertiser-policy",
    title: "Advertiser Policy",
    description: "Standards for advertisers creating campaigns across every AdsGalaxy format.",
    items: [
      { href: "/policy/advertiser", label: "General Policy", icon: Megaphone },
      { href: "/policy/advertiser/channel", label: "Channel Campaign Policy", icon: Tv },
      { href: "/policy/advertiser/channel-growth", label: "Channel Growth Policy", icon: TrendingUp },
      { href: "/policy/advertiser/teaser", label: "Teaser Campaign Policy", icon: Megaphone },
      { href: "/policy/advertiser/mini-app", label: "Mini App Campaign Policy", icon: Smartphone },
      { href: "/policy/advertiser/bot", label: "Bot Campaign Policy", icon: Bot },
    ],
  },
] as const;

export function PolicyCenter({ policy }: { policy?: PolicyDefinition }) {
  if (!policy) {
    return (
      <div className="space-y-8">
        <PolicyHero
          eyebrow="AdsGalaxy Policy Center"
          title="Clear standards for publishers and advertisers using AdsGalaxy."
          description="Publisher and advertiser standards for every AdsGalaxy format."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {guideGroups.map((group) => (
            <section key={group.title} id={group.id} className="scroll-mt-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">{group.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{group.description}</p>
              <div className="mt-5 space-y-2">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600">
                    <item.icon size={18} className="shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const rules = policyRulesForScope(policy.scope);

  return (
    <div className="space-y-6">
      <PolicyHero eyebrow="AdsGalaxy Policy Center" title={policy.name} description={policy.summary} />
      <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <header>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Policy rules</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">Each rule explains the standard and the steps needed to resolve a rejection.</p>
        </header>
        <div className="mt-10 space-y-10">
          {rules.map((rule) => (
            <section
              key={rule.rule_key}
              id={`rule-${rule.public_number}`}
              data-rule-key={rule.rule_key}
              className="scroll-mt-28 transition target:bg-sky-50"
            >
              <h3 className="text-lg font-black text-slate-950">{rule.public_number}. {rule.public_title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{rule.public_description}</p>
              <p className="mt-3 text-sm leading-7 text-slate-600">{rule.resolution}</p>
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}

function PolicyHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">{eyebrow}</p>
      <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base">{description}</p>
    </section>
  );
}
