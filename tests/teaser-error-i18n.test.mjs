import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const errorSource=fs.readFileSync("src/lib/teaserErrorMessage.ts","utf8");
const en=fs.readFileSync("src/i18n/en.ts","utf8"),ru=fs.readFileSync("src/i18n/ru.ts","utf8");
const keys=[...errorSource.matchAll(/"(teaser\.error\.[^"]+)"/g)].map(x=>x[1]);
test("Teaser errors use safe catalog keys with a generic fallback",()=>{assert.ok(keys.length>=28);assert.match(errorSource,/\|\| "teaser\.error\.generic"/);assert.doesNotMatch(errorSource,/error\.message|SQLSTATE|Telegram RPC/);});
test("all Teaser error keys exist in English and Russian",()=>{for(const key of keys){assert.match(en,new RegExp(`"${key}"\\s*:\\s*"[^"\\n]+"`));assert.match(ru,new RegExp(`"${key}"\\s*:\\s*"[^"\\n]+"`));}});
test("override presentation strings exist in both catalogs",()=>{for(const key of ["teaser.normalTargeting","teaser.targetingOverride","teaser.sendWithOverride","teaser.overrideWarning","teaser.overrideConfirm"]){assert.match(en,new RegExp(`"${key}"\\s*:\\s*"[^"\\n]+"`));assert.match(ru,new RegExp(`"${key}"\\s*:\\s*"[^"\\n]+"`));}});
