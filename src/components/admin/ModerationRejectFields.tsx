"use client";
import { activePolicyRulesForScopes, type PolicyScope } from "@/lib/policyRegistry";

export default function ModerationRejectFields({ scopes, ruleKey, internalNote, onRuleKey, onInternalNote }: { scopes: PolicyScope[]; ruleKey: string; internalNote: string; onRuleKey(value: string): void; onInternalNote(value: string): void }) {
  const rules = activePolicyRulesForScopes(scopes);
  return <div className="space-y-3 text-left">
    <label className="block"><span className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Reason required</span><select required value={ruleKey} onChange={(event) => onRuleKey(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-red-400"><option value="">Select a policy reason</option>{rules.map((rule) => <option key={rule.rule_key} value={rule.rule_key}>Rule {rule.public_number} · {rule.admin_label}</option>)}</select></label>
    <label className="block"><span className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Internal note (optional)</span><textarea rows={2} maxLength={300} value={internalNote} onChange={(event) => onInternalNote(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-red-400" /><span className="mt-1 block text-right text-[10px] text-slate-400">{internalNote.length}/300</span></label>
  </div>;
}
