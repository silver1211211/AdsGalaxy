import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync("src/lib/channelCpmRedistribution.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const allocate = mod.exports.redistributeCpmPublisherPool;
const U = 100000000n;
const row = (publisherId, neutralUnits, verifiedClicks = 0, options = {}) => ({ publisherId, neutralUnits, validViews: 1000, verifiedClicks, qualityBps: 10000, engagementTrusted: true, ...options });
const amounts = rows => rows.map(r => r.finalUnits);
const sample = () => [row(1, 2n*U, 100), row(2, 15n*U/10n), row(3, 15n*U/10n), row(4, U)];

test("empty and one publisher stay neutral", () => { assert.deepEqual(allocate([]), []); assert.deepEqual(amounts(allocate([row(1,U,30)])), [U]); });
test("multiple publishers without clicks remain neutral", () => { const x=[row(1,2n*U),row(2,U)]; assert.deepEqual(amounts(allocate(x)),[2n*U,U]); });
test("strong performer receives a fully funded uplift", () => { const r=allocate(sample()); assert.deepEqual(amounts(r),[220000000n,142500000n,142500000n,95000000n]); assert.equal(r.reduce((s,x)=>s+x.adjustmentUnits,0n),0n); });
test("insufficient donor capacity reduces the uplift", () => { const r=allocate([row(1,10n*U,100),row(2,U)]); assert.deepEqual(amounts(r),[1005000000n,95000000n]); });
test("receiver and donor bounds hold", () => { for(const r of allocate(sample())) { assert.ok(r.adjustmentUnits<=r.neutralUnits/10n); assert.ok(r.adjustmentUnits>=-(r.neutralUnits/20n)); } });
test("tiny sample cannot obtain an uplift", () => { const r=allocate([row(1,U,1,{validViews:1}),row(2,U,0)]); assert.deepEqual(amounts(r),[U,U]); });
test("untrusted or low quality clicks cannot earn uplift", () => { const r=allocate([row(1,U,100,{engagementTrusted:false}),row(2,U,100,{qualityBps:7999}),row(3,U,0)]); assert.deepEqual(amounts(r),[U,U,U]); });
test("equal engagement remains neutral", () => { const r=allocate([row(1,2n*U,10),row(2,U,10)]); assert.deepEqual(amounts(r),[2n*U,U]); });
test("zero views and zero allocation stay neutral", () => { const r=allocate([row(1,U,0,{validViews:0}),row(2,0n,50),row(3,U,0)]); assert.deepEqual(amounts(r),[U,0n,U]); });
test("invalid publisher and engagement data are rejected", () => { for(const bad of [row(1,-1n),row(1,U,-1),row(1,U,1001),row(1,U,0,{qualityBps:10001}),row(1,U,0,{validViews:NaN}),row(0,U)]) assert.throws(()=>allocate([bad])); assert.throws(()=>allocate([row(1,U),row(1,U)])); });
test("rounding preserves every unit with deterministic ties", () => { const r=allocate([row(1,101n,100),row(2,21n),row(3,21n)]); assert.deepEqual(amounts(r),[103n,20n,20n]); assert.equal(r.reduce((s,x)=>s+x.finalUnits,0n),143n); });
test("input order never changes results", () => { const x=sample(); assert.deepEqual(allocate(x),allocate([x[3],x[1],x[0],x[2]])); });
test("varied pools conserve all units and stay within bounds", () => { for(let n=1;n<=250;n++){ const x=[row(1,BigInt(n*179+1),n%100),row(2,BigInt(n*73+3),n%31),row(3,BigInt(n*41+2),0)]; const r=allocate(x); assert.equal(r.reduce((a,v)=>a+v.finalUnits,0n),x.reduce((a,v)=>a+v.neutralUnits,0n)); for(const p of r){ assert.ok(p.adjustmentUnits<=p.neutralUnits/10n); assert.ok(p.adjustmentUnits>=-(p.neutralUnits/20n)); } } });

test("equal engagement across different view counts remains neutral", () => { const r=allocate([row(1,2n*U,1,{validViews:100}),row(2,U,10,{validViews:1000})]); assert.deepEqual(amounts(r),[2n*U,U]); });

test("one click in a minimally sized sample cannot earn an uplift", () => { const r=allocate([row(1,U,1,{validViews:100}),row(2,U,0,{validViews:1000})]); assert.deepEqual(amounts(r),[U,U]); });
