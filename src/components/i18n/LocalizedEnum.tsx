"use client";

import { useTranslations } from "@/i18n/client";
import { translateMetric, translateStatus } from "@/i18n";

export function StatusText({ value }: { value: unknown }) {
  const { locale } = useTranslations();
  return <>{translateStatus(value, locale)}</>;
}

export function MetricText({ value }: { value: unknown }) {
  const { locale } = useTranslations();
  return <>{translateMetric(value, locale)}</>;
}
