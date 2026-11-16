import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createRequire } from "node:module";
const nativeRequire = createRequire(import.meta.url);
function load(file, deps) {
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(
    module, module.exports, name => deps[name] ?? (name.startsWith("@/") ? {} : nativeRequire(name)),
  );
  return module.exports;
}
const amount = load("src/lib/withdrawalAmount.ts", {});
test("admin holds a subminimum request without historical review", async () => {
  let rollback = 0, commit = 0, writes = 0;
  const connection = {
    beginTransaction: async () => {},
    rollback: async () => { rollback++; },
    commit: async () => { commit++; },
    release: () => {},
    query: async sql => {
      if (sql.includes("FROM withdrawals w")) return [[{
        id: 84, user_id: 1, amount: "0.50000000", status: "pending",
        refunded: 0, paid_out: 0, balance_locked: "0.50000000",
        balance_available: "50.00000000", network: "BEP-20", address: "valid", created_at: "2026-11-02T11:36:20Z",
      }]];
      writes++;
      throw new Error("unexpected_financial_query");
    },
  };
  const route = load("src/app/api/admin/withdrawals/route.ts", {
    "next/server": { NextResponse: { json: (body, opts = {}) =>
      ({ body, status: opts.status ?? 200 }) } },
    "@/lib/db": { default: { getConnection: async () => connection } },
    "@/lib/adminAuth": { requireAdminPermission: async () =>
      ({ admin: { id: 1 }, response: null }) },
    "@/lib/withdrawalAmount": amount,
    "@/lib/withdrawalNetworks": { validateWithdrawalDestination: () => ({ ok: true, network: "BEP-20", fee: 0 }) },
  });
  const result = await route.PATCH({ json: async () => ({ id: 84, action: "approve" }) });
  assert.deepEqual([result.status, result.body.code], [409, "HISTORICAL_POLICY_REVIEW_REQUIRED"]);
  assert.deepEqual([rollback, commit, writes], [1, 0, 0]);
});
