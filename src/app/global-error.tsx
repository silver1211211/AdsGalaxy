"use client";

import { useEffect } from "react";
import ErrorExperience from "@/components/shared/ErrorExperience";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Global application failure", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#07111f", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <ErrorExperience
          code="500"
          title="AdsGalaxy needs a moment"
          message="A critical page error interrupted your session. Try loading it again, or return safely to the homepage."
          onRetry={unstable_retry}
        />
      </body>
    </html>
  );
}
