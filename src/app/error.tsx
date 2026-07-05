"use client";

import { useEffect } from "react";
import ErrorExperience from "@/components/shared/ErrorExperience";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Page rendering failed", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <ErrorExperience
      code="500"
      title="Something went off course"
      message="AdsGalaxy hit an unexpected problem while loading this page. You can try again or return to the homepage."
      onRetry={unstable_retry}
    />
  );
}
