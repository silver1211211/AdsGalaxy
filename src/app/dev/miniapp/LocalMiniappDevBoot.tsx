"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppBootState from "@/components/shared/AppBootState";

type LocalMiniappDevBootProps = {
  initData: string;
};

const LOCAL_MINIAPP_DEV_STORAGE_KEY = "adsgalaxy_local_miniapp_dev";

export default function LocalMiniappDevBoot({ initData }: LocalMiniappDevBootProps) {
  const router = useRouter();

  useEffect(() => {
    // Local-only Mini App development support. This token is only accepted by
    // the server when NODE_ENV is non-production, the host is local, and
    // ENABLE_LOCAL_MINIAPP_DEV=true.
    window.localStorage.setItem(LOCAL_MINIAPP_DEV_STORAGE_KEY, initData);
    router.replace("/publisher");
  }, [initData, router]);

  return (
    <AppBootState
      title="Opening Local Mini App"
      message="Preparing a local development Mini App session..."
    />
  );
}
