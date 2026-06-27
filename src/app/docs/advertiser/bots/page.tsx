import { BotAdExample } from "@/components/docs/AdPreview";
import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";

const sections: DocsSection[] = [
  {
    id: "overview",
    title: "Bot broadcast campaigns",
    body: [
      "Bot campaigns deliver approved advertiser messages through eligible Telegram bots.",
      "Use this format when you want a broadcast-style message sent to bot audiences rather than a channel post or Mini App ad.",
    ],
  },
  {
    id: "fields",
    title: "Fields in the bot campaign flow",
    body: ["The Bot Campaign path uses the existing campaign creation flow with broadcast as the campaign type."],
    bullets: [
      "Campaign Name: internal dashboard name.",
      "Category: topic used for matching and review.",
      "Message Text: broadcast copy.",
      "Parse Mode: Markdown, HTML, or None.",
      "Ad Image: optional image for the message.",
      "Campaign Link: destination URL for the action button.",
      "Button Text: call-to-action label.",
      "CPM and Total Budget: spend controls for the campaign.",
      "Targeting Continents: geographic targeting for delivery.",
    ],
  },
  {
    id: "approval",
    title: "Approval and delivery",
    body: [
      "Submitted bot campaigns require approval. Approved campaigns can deliver through eligible bots when audience and budget conditions are met.",
      "Delivery uses the existing AdsGalaxy bot broadcast system. This documentation does not change broadcast delivery behavior.",
    ],
  },
  {
    id: "reporting",
    title: "Spend and reporting",
    body: [
      "Advertisers can review campaign status, delivery activity, spend, today spend, and recent activity in advertiser reporting.",
      "Publisher-side earnings details are not shown to advertisers.",
    ],
  },
];

export default function AdvertiserBotsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Advertiser Documentation"
      title="Bot Advertising"
      intro="Create approved broadcast campaigns for eligible Telegram bot audiences."
      sections={sections}
    >
      <section id="how-ads-appear" className="scroll-mt-28 space-y-4">
        <div className="rounded-2xl bg-blue-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">How ads appear to users</p>
          <h2 className="mt-2 text-lg font-black text-slate-900">Telegram bot message example</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This is an AdsGalaxy visual example with generic broadcast copy.
          </p>
        </div>
        <BotAdExample />
      </section>
    </DocsArticle>
  );
}
