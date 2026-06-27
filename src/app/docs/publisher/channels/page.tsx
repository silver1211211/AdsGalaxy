import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";

const sections: DocsSection[] = [
  {
    id: "overview",
    title: "How channel monetization works",
    body: [
      "Channel monetization lets approved Telegram channel owners earn when AdsGalaxy places approved advertiser posts into their channels.",
      "AdsGalaxy uses your channel information, category, audience signals, posting capacity, and posting times to decide when a matching campaign can be placed.",
    ],
  },
  {
    id: "requirements",
    title: "Requirements before submitting",
    body: ["Submit real channels only. The channel should have a public identity, consistent content, and an audience that matches the category you choose."],
    bullets: [
      "Channel username: use the public Telegram username without misleading spelling or fake branding.",
      "Public access: the channel should be visible enough for AdsGalaxy review and delivery checks.",
      "AdsGalaxy bot admin: add the AdsGalaxy bot as an admin when the channel setup flow asks you to. This allows posting and status checks.",
      "Content quality: avoid restricted, misleading, or spam-heavy channels.",
    ],
  },
  {
    id: "fields",
    title: "Fields in the channel form",
    body: ["Fill every field with production-ready information. Review uses these values to decide whether the channel is safe for advertiser campaigns."],
    bullets: [
      "Channel title: the readable name advertisers and admins use to identify the channel.",
      "Channel username: the Telegram @username used to verify and post to the channel.",
      "Category: the topic that best describes the channel audience.",
      "Posts per day: the maximum number of advertiser posts you are willing to receive in a day.",
      "Posting times: the specific times your audience is most active. These are used for scheduling, not for manual earnings control.",
    ],
  },
  {
    id: "approval",
    title: "Approval lifecycle",
    body: [
      "New channels enter pending review. Admins can approve, reject, pause, or review channel details.",
      "Approved active channels become eligible for campaign delivery. Rejected channels should be corrected and resubmitted only when the underlying issue is fixed.",
    ],
  },
  {
    id: "earnings",
    title: "Earnings and withdrawals",
    body: [
      "Channel earnings appear in the publisher earnings area after eligible delivery and platform processing.",
      "Withdrawals use the normal publisher withdrawal flow and available balance rules. The docs do not publish internal earnings formulas or private review logic.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    body: ["If a channel is not receiving ads, check the basics before contacting support."],
    bullets: [
      "Confirm the channel is approved and active.",
      "Confirm posting times are set and realistic.",
      "Confirm the AdsGalaxy bot still has the required admin access.",
      "Confirm the channel category matches current advertiser demand.",
      "Review recent status changes in your channel dashboard.",
    ],
  },
];

export default function PublisherChannelsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Publisher Documentation"
      title="Channel Monetization"
      intro="A complete guide to submitting Telegram channels, passing review, setting posting availability, and understanding channel earnings."
      sections={sections}
    />
  );
}
