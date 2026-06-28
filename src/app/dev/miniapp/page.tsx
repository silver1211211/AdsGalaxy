import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  buildLocalMiniappDevInitData,
  isLocalMiniappDevServerAllowed,
} from "@/lib/localMiniappDev";
import LocalMiniappDevBoot from "./LocalMiniappDevBoot";

type DevMiniappPageProps = {
  searchParams?: Promise<{
    user?: string;
    ref?: string;
  }>;
};

export default async function DevMiniappPage({ searchParams }: DevMiniappPageProps) {
  const headersList = await headers();
  if (!isLocalMiniappDevServerAllowed(headersList.get("host"))) {
    notFound();
  }

  const params = await searchParams;
  const initData = buildLocalMiniappDevInitData(params?.user || null, params?.ref || null);

  return <LocalMiniappDevBoot initData={initData} />;
}
