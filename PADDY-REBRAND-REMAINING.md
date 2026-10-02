# Paddy rebrand — what is done, what remains

Branch `feat/paddy-branding`, pushed to `origin` (`github.com/coruairc/paddy`).

## Commits in this work

| Commit        | Scope                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `e05ef5d93a1` | Original boundary rebrand (name, UI mascot, installers, README)         |
| `151ce08f659` | Contract fixes: update launcher, gateway process title, update step ids |
| `9962de36678` | The sweep — ~17,000 substitutions across ~2,000 files                   |
| `179c40914b1` | Reconciled remaining consumers with the rebranded producers             |

2,211 files changed since `e05ef5d93a1`. Token counts on tracked files:
`OpenClaw` 38,558 → 30,039; `openclaw` 258,211 → 248,717 (−18,013).

## Verified before stopping

- `pnpm tsgo` exit 0
- corruption scan: 0 malformed tokens, 0 orphaned word-tails, 0 `a Paddy`
- line-cap ratchet exit 0 against `upstream/main` (a stale `origin/main` gives false positives)
- max-lines ratchet + `OPENCLAW_*` budget 475/475
- docs gate: format, lint, MDX, 14,624 internal links (0 broken); i18n glossary
  complete against the true base
- full suite: 0 failures observed in the final run when it was still executing;
  earlier complete runs reached 1 failure (`sanitize-text`, see below)

## 1. Confirm the full suite on a machine with a real TTY

The definitive run was still executing when this was written (3,252 passed,
0 failed at that point). Re-run `pnpm test` and confirm.

Two groups fail **only in this sandbox** and need a normal terminal to confirm:

- `src/agents/shell-snapshot.test.ts` (9 tests) and
  `src/agents/bash-tools.exec-runtime.broker.test.ts` — both drive interactive
  `bash`. This sandbox reports _"cannot set terminal process group / no job
  control"_, so the fixtures cannot source their startup files (exit 127).
- `src/infra/outbound/sanitize-text.test.ts` — one case, `🙂<limit and wait>5s`
  → `🙂5s`. Pre-existing: reproduces on a pristine checkout, both the test and
  its source are byte-identical to upstream, and the compared strings contain no
  brand token. The CJK-preceded case passes while the emoji one fails, which
  points at an astral/surrogate offset bug — the same family as the truncation
  bug fixed earlier in `projection-tool-output`.

## 2. Regenerate the Control UI i18n cache (needs model credentials)

`ui/src/i18n/.i18n/**` is generated and now **stale**: ~7,388 `OpenClaw`
occurrences, 0 `Paddy`. Source of truth is `ui/src/i18n/locales/*.ts`, which is
already rebranded.

```bash
pnpm ui:i18n:sync     # LLM-driven; needs model credentials
pnpm ui:i18n:verify   # wired into lint:ui:i18n
```

Entries are keyed by source-text hash, so the stale records are unreferenced —
no user impact, but the cache should be regenerated before release.

## 3. Native apps — deliberately untouched

`apps/**` holds ~11,400 brand lines. These are **not in the pnpm workspace**
(`pnpm-workspace.yaml` covers `.`, `ui`, `packages/*`, `extensions/*`,
`examples/*`), build separately (Gradle/Xcode/Tauri), and are store-only.
CLI and Control UI users never see those strings, which is why they were left.

If the native apps should also be Paddy:

```bash
pnpm native:i18n:sync     # regenerates catalogs into the app resource dirs
pnpm android:i18n:check
pnpm apple:i18n:check
```

## 4. Documentation filenames

19 tracked files carry `openclaw` in the **filename**, including
`docs/cli/openclaw.md`, `docs/start/why-openclaw/` (7 files),
`docs/openclaw-agent-runtime.md`, `docs/help/faq/what-is-openclaw.md`, the
banner/hero PNGs, and `docs/snippets/plugin-publish/minimal-openclaw.plugin.json`.

Not renamed because published doc URLs are a compatibility surface and one of
them is a **plugin-manifest contract** (`openclaw.plugin.json`), so a wholesale
rename is wrong. Doing it properly means: rename the pages, update
`docs/docs.json` nav destinations, update inbound links, then re-run
`pnpm docs:check-links` (it validates 14,624 links, so it will catch misses).

Until then, three doc links deliberately point at `/cli/openclaw` — they were
reverted from `/cli/paddy` because the file is still `openclaw.md`.

## 5. Intentionally kept — do not "fix" these

Recorded here so a later sweep does not re-break them. Each was verified
against a producer, a test, or persisted data:

- **npm identity**: package name `openclaw`, `openclaw@<version>` specs,
  `bin` still ships both `openclaw` and `paddy` → `openclaw.mjs`.
- **Imports**: `@openclaw/*`, `openclaw/plugin-sdk/*`, `openclaw/extension-api`.
- **Paths and files**: `openclaw.mjs`, `openclaw.plugin.json`, `~/.openclaw/`,
  `.openclaw/`, `openclaw.json`.
- **Env vars**: `OPENCLAW_*` (budget ratchet at `config/env-var-count-budget.txt`).
- **Process/service identity**: `process.title` values, `openclaw-gateway`,
  `openclaw-gateway.service`, launchd labels, Windows task names.
- **Update step ids**: `"openclaw doctor"` — matched by a `switch`
  (`update-runner-command.ts`), a resume lookup, the doctor schema guard, and
  `update-step-identity.ts`'s public-id table.
- **Published wire schema**: `Type.Literal("openclaw update")` and
  `("openclaw node restart")` in `@openclaw/gateway-protocol`, plus the two
  comparisons in `ui/src/pages/new-session/discovery.ts`.
- **Persisted config value**: `openclaw:approval-disabled` (QQBot `allowFrom`
  sentinel) — renaming it would fail the sentinel check and uppercase the id.
- **HMAC contexts**: `openclaw:gateway-approval-runtime-token:v1`,
  `openclaw:gateway-agent-runtime-identity-token:v1`.
- **Wire identity**: provider `User-Agent` / `x-goog-api-client` tokens.
- **Git refs**: `refs/openclaw/*`, `openclaw/<branch>` worktree prefixes.
- **Serialized message ids**: `customType: "openclaw.*"`, `openclaw:*`.
- **Marketing/HQ URLs**: `openclaw.ai`, `docs.openclaw.ai`,
  `github.com/openclaw/openclaw`; the `OpenClaw Foundation` legal identity in
  LICENSE/NOTICE and package `author` fields.
- **Historical records**: `docs/releases/**` and `CHANGELOG/**` — rewritable only
  by falsifying history.
- **Compatibility mappers** that accept both names on purpose:
  `command-format.ts` (`paddy|openclaw` prefix), the completion profile header
  (`# OpenClaw Completion` / `# Paddy Completion`), the Matrix device-name
  prefixes (`"OpenClaw "` / `"Paddy "`), and the crabbox version probe.

## 6. Residual occurrences

Measured metric — hand-editable, non-generated, in-scope
`openclaw <command>` mentions: **3**, all justified:

| Site                                          | Why                                                            |
| --------------------------------------------- | -------------------------------------------------------------- |
| `docs/platforms/linux.md:499`                 | systemd `ExecStart=/usr/local/bin/openclaw …`; both bins exist |
| `ui/src/pages/new-session/discovery.ts:93-94` | compares against the published protocol literals               |

The coarse census still reports ~29,600 "user-facing candidate" lines. That
filter deliberately over-counts: it includes test fixtures, code comments that
document the kept contracts above, and strings inside kept identifiers. It is
not a to-do list; the command-mention metric above is.

Out-of-scope by decision, not by omission: `apps/**` (~11.4k),
`.github/**`+`scripts/**`+`test/**`+`.agents/**`+`security/**`+`qa/**` (~6k),
`docs/releases/**`+`CHANGELOG/**` (~48.8k), and generated caches (~10k) —
together the bulk of the remaining raw count.

## 7. Housekeeping

- `CLAUDE.md` is untracked at the repo root, left over from before the
  Claude Code upgrade that made native `AGENTS.md` loading work. This repo
  deliberately retired its `CLAUDE.md` files; deleting it is recommended so it
  cannot shadow `AGENTS.md` again.
- The sweep ran through a tool whose only possible substitution is the 8-char
  token `openclaw` → `paddy` (or `OpenClaw` → `Paddy`), with a string/comment
  scanner for code. Reuse it for any further sweep rather than a fresh regex:
  it is what caught both misclassifications (a local variable and a lookup key)
  that would otherwise have shipped.

## 8. Not started

Hermes memory work — explicitly deferred until this baseline is verified, per
the earlier instruction. See `PADDY-PHASE0-HERMES.md` for the Phase 0 finding
that OpenClaw's `memory-core` already supersedes most of the prior design.
