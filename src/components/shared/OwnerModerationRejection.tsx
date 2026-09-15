"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import ModerationRejectionNotice, { type ModerationRejectionSummary } from "@/components/shared/ModerationRejectionNotice";

export default function OwnerModerationRejection({ entityType, entityId, status }: { entityType: string; entityId: number | string; status: string }) {
  const [rejection, setRejection] = useState<ModerationRejectionSummary | null | undefined>(undefined);
  useEffect(() => {
    if (String(status).toLowerCase() !== "rejected") return;
    let active = true;
    apiFetch(`/api/moderation-rejections?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(String(entityId))}`).then(async (response) => {
      const data = await response.json().catch(() => ({})); if (active) setRejection(response.ok ? data.rejection || null : null);
    }).catch(() => { if (active) setRejection(null); });
    return () => { active = false; };
  }, [entityId, entityType, status]);
  if (String(status).toLowerCase() !== "rejected" || rejection === undefined) return null;
  return <ModerationRejectionNotice status={status} rejection={rejection} language={typeof document !== "undefined" ? document.documentElement.lang : "en"} />;
}
