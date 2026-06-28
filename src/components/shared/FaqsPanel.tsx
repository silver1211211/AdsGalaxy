"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type FaqType = "referral" | "publisher" | "advertiser";

type FaqItem = {
  id: number;
  question: string;
  answer: string;
};

type FaqGroups = Record<FaqType, FaqItem[]>;

const emptyFaqs: FaqGroups = {
  referral: [],
  publisher: [],
  advertiser: [],
};

const tabs: Array<{ key: FaqType; label: string }> = [
  { key: "referral", label: "Referral FAQs" },
  { key: "publisher", label: "Publisher FAQs" },
  { key: "advertiser", label: "Advertiser FAQs" },
];

export default function FaqsPanel({ defaultTab = "referral" }: { defaultTab?: FaqType }) {
  const [faqs, setFaqs] = useState<FaqGroups>(emptyFaqs);
  const [activeTab, setActiveTab] = useState<FaqType>(defaultTab);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/faqs")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setFaqs({
          referral: Array.isArray(data.referral) ? data.referral : [],
          publisher: Array.isArray(data.publisher) ? data.publisher : [],
          advertiser: Array.isArray(data.advertiser) ? data.advertiser : [],
        });
      })
      .catch((err) => console.error("Error fetching FAQs:", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentFaqs = faqs[activeTab] || [];

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Frequently Asked Questions</h1>

      <div className="mb-8 grid grid-cols-1 gap-2 rounded-xl bg-slate-100 p-1 sm:grid-cols-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setExpandedId(null);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="py-10 text-center text-slate-500">Loading FAQs...</div>
        ) : currentFaqs.length === 0 ? (
          <div className="py-10 text-center text-slate-500">No FAQs available yet.</div>
        ) : (
          currentFaqs.map((faq) => (
            <div
              key={`${activeTab}-${faq.id}`}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-200"
            >
              <button
                onClick={() => setExpandedId(expandedId === faq.id ? null : faq.id)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50 focus:outline-none"
              >
                <span className="font-semibold text-slate-900">{faq.question}</span>
                {expandedId === faq.id ? (
                  <ChevronUp className="ml-4 shrink-0 text-slate-400" size={20} />
                ) : (
                  <ChevronDown className="ml-4 shrink-0 text-slate-400" size={20} />
                )}
              </button>

              {expandedId === faq.id && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 text-slate-600">
                  {faq.answer}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
