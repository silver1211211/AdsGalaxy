"use client";

import { ImageOff } from "lucide-react";

export default function TelegramCampaignPreview({ image, title, message, buttonText, destination, context = "Sponsored message" }: {
  image?: string | null;
  title?: string;
  message?: string;
  buttonText?: string;
  destination?: string;
  context?: string;
}) {
  return (
    <section aria-label="Telegram Preview" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-[#e7f0f7] p-3 sm:p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Telegram Preview</p>
      <div className="max-w-md overflow-hidden rounded-2xl rounded-bl-md bg-white shadow-sm">
        {image ? <img src={image} alt="Campaign creative preview" onError={(event) => { event.currentTarget.hidden = true; }} className="aspect-[1.91/1] w-full object-cover" /> : <div className="flex h-20 items-center justify-center bg-slate-100 text-slate-400"><ImageOff size={20} /></div>}
        <div className="min-w-0 space-y-2 p-3">
          <p className="text-[10px] font-semibold text-blue-600">{context}</p>
          <p className="break-words text-sm font-bold text-slate-950">{title?.trim() || "Your campaign title"}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-5 text-slate-700">{message?.trim() || "Your campaign message will appear here."}</p>
          {destination && <p className="truncate text-[11px] text-slate-400" title={destination}>{destination}</p>}
        </div>
        <div className="border-t border-slate-100 px-3 py-2 text-center text-xs font-bold text-blue-600">{buttonText?.trim() || "Learn more"}</div>
      </div>
    </section>
  );
}
