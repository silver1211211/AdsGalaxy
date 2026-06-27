import DocsArticle, { type DocsSection } from "@/components/docs/DocsArticle";

const sections: DocsSection[] = [
  {
    id: "overview",
    title: "How bot monetization works",
    body: [
      "Bot monetization lets approved Telegram bot owners earn from eligible advertiser broadcast delivery.",
      "AdsGalaxy uses approved bot details and reachable bot users to determine campaign delivery opportunities.",
    ],
  },
  {
    id: "requirements",
    title: "Requirements",
    body: ["Submit real bots with authentic users and compliant content. Bots with artificial activity or misleading identities can be rejected."],
    bullets: [
      "Bot name: the readable bot name shown in your dashboard.",
      "Bot username: the Telegram bot username.",
      "Bot token or required connection details: used by the platform to verify and manage the bot integration where required by the form.",
      "Users: imported or collected users must represent real reachable Telegram users.",
    ],
  },
  {
    id: "add-bot",
    title: "Add bot flow",
    body: [
      "Open Publisher > Bots, add the bot details, and submit the bot for review.",
      "After approval, keep the bot active and maintain healthy user collection so eligible broadcasts can be delivered.",
    ],
  },
  {
    id: "users",
    title: "Importing users",
    body: [
      "The bot area includes user management tools. Import only legitimate users who interacted with your bot or are otherwise valid for Telegram delivery.",
      "Healthy user lists improve delivery reliability and reduce review issues.",
    ],
  },
  {
    id: "reporting",
    title: "Reporting, earnings, and withdrawals",
    body: [
      "Bot reporting focuses on delivery activity and bot status. Earnings appear after eligible broadcast delivery and platform processing.",
      "Withdrawals use the normal publisher withdrawal flow and available balance rules.",
    ],
  },
];

export default function PublisherBotsDocsPage() {
  return (
    <DocsArticle
      eyebrow="Publisher Documentation"
      title="Bot Monetization"
      intro="Connect Telegram bots, manage reachable users, and monetize approved broadcast delivery."
      sections={sections}
    />
  );
}
