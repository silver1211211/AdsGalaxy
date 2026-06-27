"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import SmartRecommendationsPanel from "@/components/smart/SmartRecommendationsPanel";

export default function AdminSmartRecommendationsPage() {
  return (
    <AdminLayout>
      <SmartRecommendationsPanel
        endpoint="/api/admin/smart-recommendations"
        title="Smart Recommendations"
        intro="Rule-based, AI-ready recommendations and alerts for campaign efficiency, inventory allocation, traffic quality, and safe automation."
        showAutomationMode
      />
    </AdminLayout>
  );
}
