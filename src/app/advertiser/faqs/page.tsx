"use client";

import React, { useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useHeader } from "@/context/HeaderContext";
import FaqsPanel from "@/components/shared/FaqsPanel";

export default function AdvertiserFAQsPage() {
  const { setTitle } = useHeader();

  useEffect(() => {
    setTitle("FAQs");
  }, [setTitle]);

  return (
    <DashboardLayout type="advertiser">
      <FaqsPanel defaultTab="advertiser" />
    </DashboardLayout>
  );
}
