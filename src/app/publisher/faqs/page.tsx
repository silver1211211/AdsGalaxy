"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useHeader } from "@/context/HeaderContext";

export default function PublisherFAQsPage() {
  const { setTitle } = useHeader();
  const [faqs, setFaqs] = useState({ publisher: [], advertiser: [] });
  const [activeTab, setActiveTab] = useState<'publisher' | 'advertiser'>('publisher');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    setTitle("FAQs");
    fetch("/api/faqs")
      .then(res => res.json())
      .then(data => setFaqs(data))
      .catch(err => console.error("Error fetching FAQs:", err));
  }, [setTitle]);

  const toggleFaq = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const currentFaqs = faqs[activeTab] || [];

  return (
    <DashboardLayout type="publisher">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Frequently Asked Questions</h1>
        
        {/* Tab Selection */}
        <div className="flex space-x-2 bg-slate-100 p-1 rounded-xl mb-8">
          <button
            onClick={() => setActiveTab('publisher')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'publisher' 
                ? 'bg-white text-slate-900 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Publisher FAQs
          </button>
          <button
            onClick={() => setActiveTab('advertiser')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'advertiser' 
                ? 'bg-white text-slate-900 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Advertiser FAQs
          </button>
        </div>

        {/* FAQs List */}
        <div className="space-y-4">
          {currentFaqs.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              Loading FAQs...
            </div>
          ) : (
            currentFaqs.map((faq: any) => (
              <div 
                key={faq.id} 
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden transition-all duration-200"
              >
                <button
                  onClick={() => toggleFaq(faq.id)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 focus:outline-none"
                >
                  <span className="font-semibold text-slate-900">{faq.question}</span>
                  {expandedId === faq.id ? (
                    <ChevronUp className="text-slate-400 flex-shrink-0 ml-4" size={20} />
                  ) : (
                    <ChevronDown className="text-slate-400 flex-shrink-0 ml-4" size={20} />
                  )}
                </button>
                
                {expandedId === faq.id && (
                  <div className="px-4 pb-4 text-slate-600 border-t border-slate-100 pt-3">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}