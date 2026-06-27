"use client";

import React from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import SmartRecommendationsPanel from "@/components/smart/SmartRecommendationsPanel";
import { useHeader } from "@/context/HeaderContext";

export default function PublisherRecommendationsPage() {
  const { setTitle } = useHeader();

  React.useEffect(() => {
    setTitle("Smart Recommendations");
  }, [setTitle]);

  return (
    <DashboardLayout type="publisher">
      <SmartRecommendationsPanel
        endpoint="/api/publisher/recommendations"
        title="Smart Recommendations"
        intro="Actionable ideas to improve channel health, bot reachability, Mini App completion rate, inventory quality, and publisher earnings."
      />
    </DashboardLayout>
  );
}
