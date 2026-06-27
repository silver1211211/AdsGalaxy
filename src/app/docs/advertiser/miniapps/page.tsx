import { MiniAppAdExample } from "@/components/docs/AdPreview";
import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";

const sections: DocsSection[] = [
  {
    id: "overview",
    title: "Mini App advertising",
    body: [
      "Mini App campaigns place AdsGalaxy ads inside eligible Telegram Mini Apps.",
      "This format is built for interactive attention: a user reaches an eligible moment, AdsGalaxy shows an approved ad, and advertiser-safe reporting records performance.",
    ],
  },
  {
    id: "creation",
    title: "Create campaign flow",
    body: ["Open Advertiser > Create Campaign > Mini App Campaign and submit the campaign for review."],
    bullets: [
      "Campaign Name: advertiser dashboard name.",
      "Ad Title: headline shown in the Mini App ad surface.",
      "Ad Description: short text explaining the offer.",
      "Thumbnail/Image URL: image used in the ad preview.",
      "Landing URL: destination opened by the ad action.",
      "Budget: funds reserved for the campaign.",
      "Target Countries: optional comma-separated two-letter country codes.",
    ],
  },
  {
    id: "campaign-examples",
    title: "Campaign examples",
    body: [
      "A Mini App campaign can promote a Telegram community, product page, app launch, offer, or content destination.",
      "Use clear ad titles, concise descriptions, and a direct landing URL that matches the campaign promise.",
    ],
  },
  {
    id: "approval",
    title: "Approval and budget usage",
    body: [
      "Mini App campaigns require admin approval before delivery. Admins manage eligibility and campaign CPM settings.",
      "Advertisers should track remaining budget, lifetime spend, and today spend in the reporting table.",
    ],
  },
  {
    id: "targeting",
    title: "Targeting",
    body: [
      "Advertisers can target selected countries when creating a Mini App campaign.",
      "Campaign review confirms whether the campaign is suitable for AdsGalaxy Mini App placements before it can deliver.",
    ],
  },
  {
    id: "audience-reach",
    title: "Audience reach",
    body: [
      "Reach depends on approved Mini App inventory, selected countries, campaign budget, and platform pacing controls.",
      "AdsGalaxy prioritizes stable delivery and advertiser-safe reporting over exposing publisher or network internals.",
    ],
  },
  {
    id: "reporting",
    title: "Advertiser-safe reporting",
    body: [
      "Mini App advertiser reporting shows campaign type, status, lifetime impressions, today impressions, yesterday impressions, lifetime spend, today spend, remaining budget, and last displayed time.",
      "Publisher-side earnings, private platform settings, internal calculations, and private records are not exposed to advertisers.",
    ],
  },
  {
    id: "cpm-explanation",
    title: "CPM basics",
    body: [
      "CPM means cost per 1,000 impressions. Your campaign budget is spent as approved Mini App ad impressions are delivered.",
      "Campaign reporting shows spend and impression activity so advertisers can understand delivery without seeing private publisher earnings or internal calculations.",
    ],
  },
  {
    id: "protection",
    title: "Pacing and frequency protection",
    body: [
      "AdsGalaxy applies platform controls to keep Mini App ad delivery stable and advertiser reporting consistent.",
    ],
  },
  {
    id: "publisher-integration",
    title: "Publisher setup",
    body: [
      "Advertisers do not add developer code or Integration IDs. Publishers handle setup inside approved Mini Apps.",
      "Use advertiser docs to understand campaign creation, ad appearance, targeting, budget usage, and reporting.",
    ],
  },
];

export default function AdvertiserMiniAppsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Advertiser Documentation"
      title="Mini App Advertising"
      intro="Create Mini App campaigns and understand approval, budget usage, and advertiser-safe performance reporting."
      sections={sections}
    >
      <div className="space-y-8">
        <section id="how-ads-appear" className="scroll-mt-28">
          <div className="mb-4 rounded-2xl bg-blue-50 p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">How ads appear to users</p>
            <h2 className="mt-2 text-lg font-black text-slate-900">Mature in-app ad example</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This is a visual example only. It uses AdsGalaxy branding and generic advertiser copy.
            </p>
          </div>
          <MiniAppAdExample />
        </section>
      </div>
    </DocsArticle>
  );
}
