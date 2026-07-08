import { ChannelAdExample } from "@/components/docs/AdPreview";
import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";

const sections: DocsSection[] = [
  {
    id: "overview",
    title: "Channel campaign overview",
    body: [
      "Channel campaigns place approved advertiser messages into eligible Telegram channels.",
      "Use the unified Create Campaign flow, then choose Channel Campaign. Inside the channel form, choose View Campaign or Click Campaign.",
    ],
  },
  {
    id: "objectives",
    title: "View Campaigns and Click Campaigns",
    body: [
      "View Campaign maps to the existing AdsGalaxy type value views and is designed for reach and awareness.",
      "Click Campaign maps to the existing type value clicks and is designed for button or link engagement. Click campaigns keep tracking compatible by using the campaign button/link flow.",
    ],
  },
  {
    id: "fields",
    title: "Fields in the campaign form",
    body: ["The channel campaign form collects the exact details needed for review, posting, targeting, and reporting."],
    bullets: [
      "Campaign Name: internal name for your advertiser dashboard.",
      "Category: topic used to match campaigns with relevant publisher audiences.",
      "Campaign Objective: View Campaign or Click Campaign.",
      "Message Text: the ad copy that appears in the channel post.",
      "Ad Image: optional image, limited by the upload rules in the form.",
      "Campaign Link: the destination URL used by the action button.",
      "Button Text: the call-to-action label shown to users.",
      "CPM: your spend setting per 1000 units for the selected objective.",
      "Total Budget: funds locked for the campaign.",
      "Targeting Continents: geographic audience targeting for delivery.",
    ],
  },
  {
    id: "approval",
    title: "Approval and delivery",
    body: [
      "Submitted campaigns enter review. Approved campaigns can be delivered to matching channels when availability exists.",
      "Delivery depends on approval status, targeting, budget, publisher availability, and campaign type.",
    ],
  },
  {
    id: "reporting",
    title: "Reporting",
    body: [
      "Advertisers can monitor campaign status, impressions, clicks, spend, today activity, and delivery timing from advertiser reporting areas.",
      "Publisher-side earnings details are not shown in advertiser reporting.",
    ],
  },
];

export default function AdvertiserChannelsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Advertiser Documentation"
      title="Channel Advertising"
      intro="Create Telegram channel campaigns for views or clicks while keeping delivery compatible with AdsGalaxy’s existing campaign system."
      sections={sections}
    >
      <section id="how-ads-appear" className="scroll-mt-28 space-y-4">
        <div className="rounded-2xl bg-blue-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">How ads appear to users</p>
          <h2 className="mt-2 text-lg font-black text-slate-900">Telegram channel post example</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This is an AdsGalaxy visual example with generic advertiser copy.
          </p>
        </div>
        <ChannelAdExample />
      </section>
    </DocsArticle>
  );
}
