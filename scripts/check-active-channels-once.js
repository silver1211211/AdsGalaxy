"use strict";

// Compatibility entry point. The legacy implementation demoted active channels
// after one Bot API response. All callers now use the durable identity state
// machine, which requires independent repeated failures and repairs metadata.
/* eslint-disable @typescript-eslint/no-require-imports -- legacy CommonJS cron entry point */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "sync-channel-identities.mjs")],
  {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      CHANNEL_IDENTITY_SYNC_LIMIT: process.env.CHANNEL_IDENTITY_SYNC_LIMIT || "200",
    },
    encoding: "utf8",
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
