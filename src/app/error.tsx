"use client";

import { useEffect } from "react";
import AppBootState from "@/components/shared/AppBootState";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <AppBootState
      mode="error"
      title="Unable to load AdsGalaxy"
      message="We couldn't start the Mini App. Please reload and try again."
      detail="If this continues, contact support."
      onAction={reset}
    />
  );
}
