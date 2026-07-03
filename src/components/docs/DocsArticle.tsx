import type { ReactNode } from "react";
import CopyCodeBlock from "@/components/docs/CopyCodeBlock";

export type DocsSection = {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
  code?: { language?: string; value: string };
};

export default function DocsArticle({ eyebrow, title, intro, sections, children }: { eyebrow: string; title: string; intro: string; sections: DocsSection[]; children?: ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_220px]">
      <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-white via-blue-50/40 to-white p-6 sm:p-8">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#0c9de8]">{eyebrow}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-500 sm:text-base">{intro}</p>
        </div>
        <div className="p-6 sm:p-8">
          {children && <div className="mt-8">{children}</div>}
          <div className="mt-10 space-y-8">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-28 border-t border-slate-100 pt-8">
                <h2 className="text-xl font-black tracking-tight text-slate-900">{section.title}</h2>
                <div className="mt-3 space-y-3">
                  {section.body.map((paragraph) => <p key={paragraph} className="text-sm leading-7 text-slate-600">{paragraph}</p>)}
                </div>
                {section.bullets && (
                  <ul className="mt-4 space-y-2">
                    {section.bullets.map((bullet) => <li key={bullet} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">{bullet}</li>)}
                  </ul>
                )}
                {section.code && <div className="mt-5"><CopyCodeBlock code={section.code.value} language={section.code.language} /></div>}
              </section>
            ))}
          </div>
        </div>
      </article>
      <aside className="hidden xl:block">
        <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">On this page</p>
          <div className="mt-3 space-y-1">
            {sections.map((section) => <a key={section.id} href={`#${section.id}`} className="block rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-blue-50 hover:text-blue-600">{section.title}</a>)}
          </div>
        </div>
      </aside>
    </div>
  );
}
