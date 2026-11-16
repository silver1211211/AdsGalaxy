import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import crypto from "node:crypto";
const source=fs.readFileSync("src/lib/protectedFinancialEvidence.ts","utf8");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const module={exports:{}};
new Function("require","module","exports",output)((name)=>{
 if(name==="node:crypto")return crypto;
 if(name==="./publisherBalanceReconciliation")return {
  decimalUnits:(v)=>{const m=String(v).match(/^(-?)(\d+)(?:\.(\d{1,8}))?$/);if(!m)throw Error("invalid");return BigInt(m[1]+m[2])*100000000n+BigInt((m[3]||"").padEnd(8,"0"))*(m[1]==="-"?-1n:1n)},
  unitsDecimal:(v)=>{const n=BigInt(v),a=n<0n?-n:n;return (n<0n?"-":"")+(a/100000000n)+"."+(a%100000000n).toString().padStart(8,"0")}
 };
 return {};
},module,module.exports);
const {financialEventDigest,chainDigest,verifyProtectedFinancialEvidence}=module.exports;
const event={eventId:7,userId:3,sourceEventKey:"channel:7",sourceSystem:"channel",sourceRecordId:"7",policyVersion:"v1",availableBefore:"0",availableAfter:"2",lockedBefore:"0",lockedAfter:"0",occurredAtUtc:"2026-11-01T00:00:00Z"};
function fixture(){
 const digest=financialEventDigest(event);
 const envelope={eventId:7,userId:3,accountSequence:1,eventDigest:digest,previousChainDigest:"0".repeat(64),chainDigest:chainDigest("0".repeat(64),1,digest),signature:"external-signature",signingKeyId:"key-1"};
 const provider={verifySignature:async()=>true,readExternalAnchor:async()=>({userId:3,lastAccountSequence:1,chainDigest:envelope.chainDigest})};
 return {envelope,provider};
}
test("protected status stays disabled without an independent provider",async()=>{
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[],undefined)).state,"not_provisioned");
});
test("separate signature and external anchor are required for verification",async()=>{
 const {envelope,provider}=fixture();
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[envelope],provider)).state,"verified");
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[envelope],{...provider,verifySignature:async()=>false})).reason,"invalid_signature");
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[envelope],{...provider,readExternalAnchor:async()=>null})).reason,"external_anchor_mismatch");
});
test("tamper, deletion, reorder, and broken chain fail",async()=>{
 const {envelope,provider}=fixture();
 assert.equal((await verifyProtectedFinancialEvidence(3,[{...event,availableAfter:"3"}],[envelope],provider)).reason,"digest_or_chain_mismatch");
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[],provider)).reason,"missing_or_extra_event");
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[{...envelope,accountSequence:2}],provider)).reason,"identity_or_order_gap");
 assert.equal((await verifyProtectedFinancialEvidence(3,[event],[{...envelope,previousChainDigest:"f".repeat(64)}],provider)).reason,"digest_or_chain_mismatch");
});
