"use client";

import React from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import SmartRecommendationsPanel from "@/components/smart/SmartRecommendationsPanel";
import { useHeader } from "@/context/HeaderContext";

export default function AdvertiserRecommendationsPage() {
  const { setTitle } = useHeader();

  React.useEffect(() => {
    setTitle("Smart Recommendations");
  }, [setTitle]);

  return (
    <DashboardLayout type="advertiser">
      <SmartRecommendationsPanel
        endpoint="/api/advertiser/recommendations"
        title="Smart Recommendations"
        intro="Campaign insights, CPM suggestions, targeting ideas, creative guidance, and next actions based on recent performance."
      />
    </DashboardLayout>
  );
}
