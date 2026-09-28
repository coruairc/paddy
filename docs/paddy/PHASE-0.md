# Phase 0 — Discovery report

Written against the OpenClaw tree on `backend/p1-core-defaults` (fork of `openclaw/openclaw`, state dir already `~/.paddy`). This is the report Section 10 asked for before Hermes integration. Implementation follows it in `extensions/memory-hermes`.

## License

OpenClaw is MIT, copyright 2026 OpenClaw Foundation (`LICENSE`). Forking, rebranding, and redistributing as `coruairc/paddy` is allowed if the copyright notice and permission notice stay in the copies. `THIRD_PARTY_NOTICES.md` stays. Hermes adds no third-party package, so it does not pull in a stricter license. No new license headers.

## Architecture

Paddy is this fork. One CLI (`paddy`, with `openclaw` kept as a compatibility alias), one gateway, one agent runtime, one config system. The old TanStack app is `coruairc/paddy-gui` and is not part of this process.

Memory is an exclusive plugin slot. `plugins.slots.memory` has one owner. `src/plugins/slots.ts` `defaultSlotIdForKey("memory")` is the implicit owner when config leaves the slot unset. `memory-core` remains installed and selectable with `plugins.slots.memory: "memory-core"`.

## Memory plugin contract

A memory plugin:

- lives in `extensions/<id>/` with `package.json` `openclaw.extensions` and `openclaw.plugin.json`
- sets `"kind": "memory"`
- calls `api.registerMemoryCapability(...)` from `register`
- may omit `capability.runtime` (confirmed in `docs/plugins/sdk-overview/memory-and-context.md`). Host search then reports as absent. That is not a load error.
- injects recall from `before_prompt_build` via `{ prependContext }`
- may curate from `agent_end` (`success`, `messages`)
- registers CLI with `api.registerCli`, loading the command module inside the callback (`await import(...)`), same as `extensions/memory-core/index.ts`
- declares tools on the manifest `contracts.tools` and `api.registerTool`

`memory-core` is the reference plugin. It also owns dreaming, workers, and workspace files. Hermes does not take those over. Dreaming stays `memory-core` (`DEFAULT_MEMORY_DREAMING_PLUGIN_ID`). With the slot unset, dreaming resolution still names `memory-core`, so the dreaming sidecar is not started beside Hermes. Selecting another memory plugin with dreaming enabled still loads `memory-core` as that sidecar. That is existing OpenClaw behavior.

Hook and tool identity differ:

- prompt hooks: `ctx.senderId`, `ctx.channel`, `ctx.sessionKey`, `ctx.agentId`
- tools: `ctx.requesterSenderId`, `ctx.messageChannel`, `ctx.sessionKey`, `ctx.agentId`

Recall uses those. It does not trust tool arguments for scope.

## Persistence

Phase 1 already set `NEW_STATE_DIRNAME` to `.paddy` and left legacy dir names empty, so Doctor does not adopt `~/.openclaw`. Hermes SQLite is `~/.paddy/hermes/memory.sqlite`, override only through `OPENCLAW_STATE_DIR` (already read by OpenClaw). No `PADDY_STATE_DIR`.

Storage is `node:sqlite` `DatabaseSync` (Node 22, already used by OpenClaw's `node-sqlite.mjs`). No new npm dependency. The store methods (`propose`, `approve`, `reject`, `rollback`, `list`, `approvedForRecall`) are the adapter boundary a later Postgres store can implement.

## What is ported

| Hermes behavior | Decision |
| --- | --- |
| SQLite under `~/.paddy`, no external database | Ported |
| Scope column on every row; per user/channel/session; `global` only when asked | Ported |
| Ranked recall, top 6, 2000 chars, approved rows in scope plus explicit global | Ported |
| Caps: memory 200/24000, user 80/8000 | Ported |
| Secret regex before insert and again before approve | Ported |
| Curator proposes, human approves | Ported. Default curator is the explicit "remember / note that" rule, not a model. `plugins.entries.memory-hermes.config.curatorModel` is reserved and optional. Unset means the deterministic rule. |
| `memory status/list/approve/reject/rollback/add` | Ported. `add`/`list` require `--scope` or `--global`. |
| Per-entry version rollback | Ported. Prior version of that id only. |
| Fail-open recall and curator | Ported. Errors go to `memory_errors` and stderr, not the user reply. |
| Dreaming, embeddings, workspace MEMORY.md, LanceDB | Not ported. They stay `memory-core`. |
| Old app memory rows | Not ported. Fresh database. |
| Binary rename `openclaw` → `paddy` | Landed for user-facing surfaces. `bin.paddy` and `bin.openclaw` both point at `openclaw.mjs`. npm package name, `OPENCLAW_*` env, `openclaw.json`, plugin imports, and service unit ids stay. |

## Files

Modified:

- `src/plugins/slots.ts` — default memory slot `memory-hermes`
- `src/plugins/slots.test.ts`
- `src/plugins/config-state.test.ts` — empty config normalizes to `memory-hermes`
- `src/plugins/bundled-plugin-metadata.test.ts` — empty-config gateway extra
- `src/plugins/channel-plugin-ids.test.ts` — fixture includes `memory-hermes`; implicit startup lists follow the new default. Explicit `memory-core` and dreaming-sidecar cases stay.
- `test/vitest/vitest.extension-memory-paths.mjs`
- `test/vitest-scoped-config.test.ts`
- `pnpm-lock.yaml` — workspace importer only, no new packages

Added:

- `extensions/memory-hermes/**`
- `docs/paddy/PHASE-0.md`

## Tests

`extensions/memory-hermes/src/hermes.test.ts` covers scope isolation, secret rejection independent of the curator, single-entry rollback, same-scope recall, explicit global, fail-open recall, and no `PADDY_STATE_DIR`.

OpenClaw tests that encoded "the implicit memory plugin id is `memory-core`" are updated. Tests that pin `plugins.slots.memory: "memory-core"` are not.

## Upstream merges

Keep Hermes inside `extensions/memory-hermes/` plus the one default-slot string. Merge `upstream/main`; do not rebase published history. The slot default is the conflict-prone line.

## Not done in this change

- Calling `curatorModel` through a provider
- Full OpenClaw suite on a clean install (needs the monorepo install)
- Postgres adapter

User-facing command name is `paddy`. `openclaw` remains an alias so the npm package check (`bin.openclaw`) and plugin SDK imports keep working.
