# Ads Galaxy live-to-Git production sync — 2026-09-03

## Authority and branch audit

- Live source: `/www/wwwroot/bots/AdsFusion`
- Branch: `main`, tracking `origin/main`
- Initial live HEAD: `688ddd0d136dee64f196b6dca106a9fc45b64ed3`
- Fetched remote HEAD: `992cc4105b72a3fb2b7afd5dff3b02ca3f80cfca`
- Divergence after `git fetch --all --prune`: live ahead 17, remote ahead 0.
- No pull, hard reset, checkout-over-live, rebase-over-live, or force push was used.

## Unsafe live-only history finding

The top live-only backup commit contained 26,567 generated-file changes,
including `.next*` build trees, two blobs larger than 300 MB, and a 33.6 MB
database dump. A direct push would both violate the requested exclusions and be
rejected by GitHub's large-file limit. That unsafe history was therefore not
pushed.

The Git candidate was constructed with a separate index rooted at the fetched
`origin/main`, then overlaid from the current live working files. This preserves
the live source as authoritative without changing, restoring, or deleting live
working files. The resulting remote update is one normal fast-forward snapshot
commit from the fetched remote base.

## Included project state

- Current application source under `src/`.
- Database migrations through `20260903_0125`, including external delivery
  sync `0122`, channel safety `0123`, Dynamic Mini App CPM v2 `0124`, and the
  request-ID collation correction `0125`.
- Current tests, project docs, root audit reports, safe configuration files,
  `.env.example`, and `deploy-vps.sh`.
- Required channel recovery scripts: `channel-recovery-policy.mjs`,
  `sync-channel-identities.mjs`, and `sync-channel-identities.sh`.

The reviewed source includes channel safety, channel recovery/audience fixes,
Dynamic Mini App CPM v2, Channel and Mini App revenue-split admin controls,
direct callbacks/external synchronization, and deployment-script updates.

## Exclusions and security review

Excluded from the candidate tree:

- `.env` and local environment variants, keys, tokens, and credentials.
- `.next`, `.next-build`, `.next-previous`, timestamped/incomplete/corrupt build
  trees, `node_modules`, and `tsconfig.tsbuildinfo` changes.
- Database dumps and `backups/`.
- PM2/runtime state, logs, temporary files, Telegram session credentials, and
  telemetry secrets.
- Runtime uploads, generated channel-classification manifests/results, and
  temporary `.bak`/`.orig` source copies.

The staged snapshot was reviewed with name/status and summary diffs,
`git diff --cached --check`, prohibited-path checks, and secret-signature scans
before commit.

## Push result

The final remote recheck confirmed that `origin/main` had not moved and the
sanitized snapshot was a normal fast-forward. Both the dry-run and real push
were blocked before transfer because this production host has no HTTPS GitHub
credential helper or authenticated GitHub CLI session; SSH authentication is
also unavailable. No remote ref was changed and no force push was attempted.

The sanitized single commit remains prepared on local `main`. Its exact commit,
HEAD, upstream, and match values are reported in the operator-visible
completion response.
