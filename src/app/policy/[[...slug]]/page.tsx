import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyCenter } from "@/components/policy/PolicyCenter";
import { POLICY_DEFINITIONS } from "@/lib/policyRegistry";

type Props = { params: Promise<{ slug?: string[] }> };
function pathFor(slug?: string[]) { return `/policy${slug?.length ? `/${slug.join("/")}` : ""}`; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params; const path = pathFor(slug); const policy = POLICY_DEFINITIONS.find((item) => item.path === path);
  const title = policy ? `${policy.name} | Ads Galaxy` : "Policy Center | Ads Galaxy";
  const description = policy?.summary || "Public Ads Galaxy publisher and advertiser policies.";
  return { title, description, alternates: { canonical: path } };
}
export default async function PolicyPage({ params }: Props) {
  const { slug } = await params; const path = pathFor(slug);
  if (path === "/policy") return <PolicyCenter />;
  const policy = POLICY_DEFINITIONS.find((item) => item.path === path);
  if (!policy) notFound();
  return <PolicyCenter policy={policy} />;
}
