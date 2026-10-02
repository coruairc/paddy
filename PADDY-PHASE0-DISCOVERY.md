# Paddy Super-Harness — Phase 0 Discovery Report

Scope: discovery only, per directive Section 10. **No code was changed.**
Baseline: `1ea49e6030a` (`main` == `origin/main` == fork of `openclaw/openclaw`).
Verified against the current tree, not against the previous Paddy/Hermes work.

---

## 0. License and provenance gate (Section 0) — PASS

**Forking, rebranding, and redistribution under `coruairc/paddy` are permitted.**

- `LICENSE` is **MIT**, © 2026 OpenClaw Foundation. MIT expressly grants the right to use, copy, modify, merge, publish, distribute, sublicense, and sell.
- **Attribution obligation:** the MIT copyright + permission notice must be included in all copies or substantial portions. Practically: keep `LICENSE` and `THIRD_PARTY_NOTICES.md` byte-intact in the fork and in the npm tarball. Both are already listed in `package.json` `files` (lines 41, 54), so the published artifact already complies — do not remove them during the rebrand.
- **Third-party incorporated code** (`THIRD_PARTY_NOTICES.md`): Pi / pi-mono (MIT, © 2025 Mario Zechner) and GitHub Octicons (MIT). No stricter licenses. Hermes is your own work, so no new inbound terms.
- **Trademark:** MIT grants no trademark rights. There is **no** trademark or brand-policy file in this repo. Paddy must not imply endorsement by the OpenClaw Foundation. Replace OpenClaw brand assets (e.g. `docs/assets/openclaw-banner-*.png`, the 🦞 branding) rather than shipping them as Paddy's identity.
- **Suggested attribution placement:** retain `LICENSE` + `THIRD_PARTY_NOTICES.md`; add a "Based on OpenClaw (MIT, © 2026 OpenClaw Foundation)" line to `README.md`, the `paddy --version` output, and the npm package description.

**Open item (could not complete here):** a full *dependency* license audit needs an installed tree (`pnpm install && pnpm licenses list`). `LOCKFILE` scan found no obvious copyleft package; `jszip` is dual MIT-or-GPL3 and MIT is electable. Treat the dependency audit as outstanding before any public release.

---

## 1. Repository state and blockers

| Item | State |
| --- | --- |
| `origin` | `git@github.com:coruairc/paddy.git` — fork exists, carries all upstream branches |
| `upstream` | **MISSING — directive Section 1/5a requires it** |
| Paddy work in this checkout | **None.** `origin/main` == `1ea49e6030a` == upstream HEAD |
| Working tree | clean (plus the untracked `CLAUDE.md` from earlier session work) |

**Blocker B1:** add `upstream`: `git remote add upstream https://github.com/openclaw/openclaw.git`. Phase 1 and Section 5a both depend on it. Not yet done — it is a repo mutation and Phase 0 is read-only.

**Blocker B2:** the directive says your Grok team has started. **Nothing has landed in this repo.** Confirm where that work lives before implementation starts, or it will fork into two incompatible efforts.

---

## 2. Two findings that change the plan

### F1 — The rebrand is not "a small greppable set of rebrand strings"

Directive decision 7 assumes isolation is easy. Measured reality:

| Surface | Count |
| --- | --- |
| Files under `src/` containing "openclaw" (case-insensitive) | **15,899** of 23,414 |
| …of those, non-test files | 8,185 |
| Files under `extensions/` containing it | 8,512 |
| `.openclaw` literal occurrences in `src/` | ~7,310 |
| `OPENCLAW_*` env-var occurrences (4k-file sample) | ~1,285 |
| "OpenClaw" prose occurrences (4k-file sample) | ~11,725 |

But the same sample shows the *load-bearing* surface is small:

- Import specifiers (`from "openclaw/plugin-sdk/..."`): **~40** in 4,000 files — negligible, and they should **not** change.

**Recommendation:** keep the internal package identity (`openclaw`, `openclaw/plugin-sdk/*`, internal symbols) exactly as upstream. Rebrand only the **user-facing boundary**, which then stays a genuinely small, greppable, low-conflict set:

1. `bin` name and CLI program name → `paddy`
2. Config/state directory `~/.openclaw` → `~/.paddy` — already single-owned by `src/config/paths.ts` (`CONFIG_FILENAME`, `resolveStateDir()`, `OPENCLAW_STATE_DIR`). This is the one high-value, low-conflict rebrand available. Audit the ~87 other hardcoded `".openclaw"` literals in non-test `src/` for stragglers.
3. User-visible product strings ("OpenClaw" in help text, errors, banners)

**Deliberately out of scope:** renaming the npm package, `OPENCLAW_*` env vars, or upstream internal identifiers. Each multiplies merge conflicts for no user-visible gain. The old Paddy GUI already used `~/.paddy` and `PADDY_*`, so `~/.paddy` is consistent with prior work.

### F2 — Most of Section 4 says "port"; the code does not exist to port

The old Hermes implementation is real but small (~8 files, ~60 KB) and is a **well-tested prototype**, not a memory engine. Inventory against the directive's requirements:

| Directive requirement | Exists in old Paddy? |
| --- | --- |
| Curated store with hard char caps, overflow never truncates | **Yes** — `memory-hermes.mjs` (MEMORY 2200 / USER 1375 chars) |
| Ranked recall (relevance, not full dump) | **Yes** — `memory-recall.ts` + `embeddings.ts` |
| Memory types (fact/preference/lesson/episode) | **Yes** |
| Per-user/conversation scope (decision 2) | **No — greenfield.** Scope was one workspace per agent profile, hardcoded `"paddy"` |
| Per-entry rollback with provenance (decision 3) | **No.** Only whole-workspace checkpoints (max 20, UI-only) |
| Deterministic secret filter (decision 5) | **No — absent entirely.** Only prompt copy saying "never store secrets" |
| Approval/promotion workflow (`--approve`/`--reject`/`--rollback`) | **No.** Tool-level approval exists but is unrelated to memory |
| Curator that doesn't blindly save | **Partial.** It is a 48-entry cap that drops oldest episodes — not dedup/decay/summarize/curation |
| FTS | **No.** Config flag only; `ftsEnabled` hardcoded `false` |
| SQLite storage (decision 1) | **No.** Postgres/PGLite + a JSON workspace blob |

**Consequence:** Section 4's "port the functionality" must be re-read as **"build the store, recall, scope, secret filter, approval, and versioning; port the cap/overflow/freeze invariants and the ranker."** The old tests are the most valuable artifact — they encode intended semantics.

---

## 3. Current OpenClaw memory architecture (what is actually there)

- **Slot:** `plugins.slots.memory` — a string plugin id, or `"none"`. Default resolves to `"memory-core"` (`src/plugins/slots.ts:17-27`, `src/plugins/config-normalization-shared.ts:178-193`).
- **Registration API:** `api.registerMemoryCapability(capability)`. **There is no `registerMemoryProvider`** — the directive's guess is wrong; the mechanism exists and is close to what it assumes.
- **Contract** (`MemoryPluginCapability`, `src/plugins/registry-contribution-types.ts:284-293`): `promptBuilder` (sync), `flushPlanResolver` (sync), `runtime`, `publicArtifacts`, `deterministicRecallToolName`, `supportsPrivateTranscriptRecall`.
  - `runtime.getMemorySearchManager(...)` is the only required runtime member; returns a `MemorySearchManager` with `search()`, `status()`, `sync()`, `close()`.
  - `runtime.authorizeSearchHits(...)` is **fail-closed** if absent (`src/plugins/memory-runtime.ts:215-220`).
- **Exclusivity:** `applyExclusiveSlotSelection` (`src/plugins/slots.ts:124-208`) disables other plugins of that kind when one takes the slot. Selecting a memory plugin is exactly the mechanism the directive assumes.
- **Default occupant:** `extensions/memory-core/` (`"kind": "memory"`). The only other memory-kind plugin is `memory-lancedb`. `memory-wiki` and `active-memory` are additive companions with no kind.
- **Recall hook points:** (a) the synchronous `promptBuilder` section, rendered into the base system prompt before the model call (`src/agents/system-prompt.ts:755-767`); (b) `before_prompt_build` hook with `prependContext`/`appendContext` — this is how `memory-lancedb` does auto-recall; (c) non-legacy context engines via `buildMemorySystemPromptAddition`.
- **Write/curation hook points:** `flushPlanResolver` (core-driven pre-compaction flush, `src/auto-reply/reply/agent-runner-memory.ts:670`), `agent_end` (post-turn, async — `memory-lancedb` auto-capture), `session_end`, `before_agent_reply` (heartbeat/cron maintenance), and memory-core's cron-driven "dreaming" consolidation.
- **Manifest:** `openclaw.plugin.json` requires `id` and `configSchema`; `"kind": "memory"` declares the slot; `cliCommands` declares root CLI commands. Core-reserved ids are rejected (`src/plugins/manifest.ts:193-207`).
- **Persistence:** plugin-owned state should use plugin-state namespaces (`api.runtime.state.openKeyedStore` / `openBlobStore`) or a plugin-owned SQLite worker store (`openSqliteWorkerStore`, as `extensions/team-reports/src/store.ts` does). State dir via `resolveStateDir()`. Note `openKeyedStore` is limited to bundled/trusted plugins — satisfied here.
- **CLI:** `api.registerCli(registrar, opts?)` gives raw Commander; nested subcommands are supported. Mutations that the running Gateway owns must go through Gateway RPC (`registerGatewayMethod` + `callGatewayFromCli`), not direct cross-process SQLite writes.

---

## 4. Exact integration points

| Concern | Mechanism |
| --- | --- |
| Occupy the memory slot | manifest `"kind": "memory"`; user sets `plugins.slots.memory: "memory-hermes"` |
| Recall into the turn | `api.registerMemoryCapability({ promptBuilder })` **and/or** `api.on("before_prompt_build", …, { requiresToolAuthority: true })` |
| Post-turn curation | `api.on("agent_end", …)` (async, non-blocking) |
| Pre-compaction flush | `flushPlanResolver` |
| CLI | `api.registerCli` root `memory`, subcommands `list\|approve\|reject\|rollback\|status` |
| CLI → state mutations | `api.registerGatewayMethod` (scopes: read `operator.read`, write/rollback `operator.write`) resolved via `callGatewayFromCli` |
| Durable storage | plugin-owned SQLite worker store in `stateDir`, or plugin-state namespaces |
| Config | manifest `configSchema` + `api.pluginConfig` (runtime) / `ctx.config.plugins.entries["memory-hermes"].config` (CLI) |

**Gotcha G1:** `memory-core` already declares the root CLI command `memory` (`extensions/memory-core/openclaw.plugin.json:14-20`). Duplicate root names are **silently skipped** with only a debug log (`src/plugins/register-plugin-cli-command-groups.ts:111-119`). Because `memory-hermes` takes the slot, `memory-core` is disabled and the name frees up — but if a user re-points the slot at `memory-lancedb`, `paddy memory …` disappears. Decide whether that is acceptable (documented) or whether Paddy should own a non-slot command name.

**Gotcha G2:** during `cli-metadata` registration `api.runtime` is a proxy that **throws on any property access** (`src/plugins/api-builder.ts:106-121`). Never dereference `api.runtime.*` at `register()` top level — only inside the registrar callback. `memory-core` is the model to copy.

**Gotcha G3:** the runtime-entry `kind` field is deprecated; declare `kind` in the manifest.

---

## 5. Files added / modified

**Added (all new — zero merge conflict by construction):**

```
extensions/memory-hermes/
  openclaw.plugin.json        # id, kind:"memory", configSchema, cliCommands
  index.ts                    # definePluginEntry + registerMemoryCapability
  cli-metadata.ts             # light root-command descriptor
  src/
    store/                    # SQLite schema + worker store (scope column, versions)
    recall/                   # ranked recall (ported ranker + embeddings)
    curator/                  # post-turn candidate generation
    secret-filter/            # NEW deterministic pattern filter
    promotion/                # NEW approval state machine
    versioning/               # per-entry versions + rollback
    cli.ts                    # memory list|approve|reject|rollback|status
    gateway-methods.ts        # RPC for mutations
    config-schema.ts
```

**Modified (deliberately minimal; the whole rebrand surface):**

| File | Change |
| --- | --- |
| `src/config/paths.ts` | `~/.paddy` default state/config dir; `PADDY_`-prefixed env with `OPENCLAW_` fallback |
| `package.json` | `bin.paddy`, package description/name display, keep internal package id |
| `README.md` | Paddy identity + MIT/OpenClaw attribution |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | **Unchanged** (attribution requirement) |

Nothing else upstream is touched. If a change is not on this list, it is a conflict source and needs justification against decision 8 (don't break OpenClaw behavior).

---

## 6. Hermes: port / adapt / drop

**Port as-is (highest value):**
- `memory-hermes.mjs` — the curated-store invariants: hard caps counted as joined entries, **overflow rejects rather than truncates**, duplicate-add as no-op, unique-match replace with ambiguity-as-error. This is genuinely good and maps cleanly onto decision 3.
- `memory-recall.ts` — pure, dependency-free composite ranker: `0.5*semantic + 0.3*recency + 0.2*importance`, 30-day recency half-life. Port with configurable weights.
- `embeddings.ts` — deterministic 64-dim hashed local embedder + optional OpenAI-compatible HTTP embedder. Keep, but **fix the stale-vector-on-edit bug** (text edits keep the old vector unless a refresh flag is passed) and treat the local embedder as a zero-dependency fallback, not a quality solution — hashed bag-of-tokens has no synonym generalization.

**Adapt:**
- `memory-store.ts` revision/optimistic-concurrency pattern (`SyncConflictError`, expected-revision writes) — excellent, but rewrite over a **memory-only** table with a scope column, not a whole-workspace JSON blob.
- Session freeze (`Session.frozenMemory`) — good prompt-snapshot semantics; adapt to OpenClaw's session model.
- Old tests — the best artifact. Port as a specification of intended semantics; replace PGLite/TanStack specifics.
- CLI surface — flags (`--target`, `--kind`, `--confirm`, `--json`) are sane; **fix the divergent naive search** in the old CLI (it had its own substring scorer instead of calling the ranker).

**Do not port:**
- `memory-store-sql.ts`, `memory-api.ts`, `cli-api.ts` — TanStack `createServerFn` + PGLite; rewrite for OpenClaw transport/DB.
- Old curator — a 48-entry cap with a subtle `slice(-48)` that can also drop older non-episode entries. Not curation. Rebuild.
- Checkpoints/rollback — whole-workspace JSON snapshots, UI-only, cap 20. Decision 3 requires per-entry; build new.
- `hermes-memory-ux.ts` marketing copy — keep only the sync-conflict helpers.

**Build new (directive requires, nothing to port):** secret filter (deterministic, pre-storage, curator-independent), per-entry versioning + rollback with provenance, per-user/conversation scope with a real scope column enforced in queries, the approval/promotion state machine, and `memory status` usage-vs-caps + fail-open error log.

---

## 7. Proposed test plan

Following OpenClaw's existing framework (Vitest) and its budgets — no new framework, no real timers.

- **Architecture-decision tests (directive Section 11):** recall/curator failure does not fail or block the turn (fail-open, decision 4); a secret-shaped string is excluded by the pattern filter **even when the curator would have proposed it** — test the filter independently of the curator (decision 5); identity A's memory never appears in identity B's recall (decision 2); rolling back one entry leaves others intact (decision 3); fresh install with zero config runs on SQLite with no external service (decision 1).
- **Contract tests:** capability registration occupies the slot; `plugins.slots.memory: "memory-hermes"` disables `memory-core`; switching the slot away releases it (decision 12 "free side effect").
- **Compatibility (Section 11):** Paddy can onboard, start the gateway, run an agent, use tools, load plugins, hold sessions — i.e. upstream behavior unbroken (decision 8).
- **Port the old semantics tests** for caps, overflow-rejects-never-truncates, freeze, and revision conflict.

---

## 8. Upstream merge strategy

- **Merge, never rebase** (decision 7) — required; Paddy is a public fork.
- **Remote setup:** `upstream` = openclaw/openclaw (**still to add**), `origin` = coruairc/paddy.
- **Conflict containment:** all Hermes code lives under `extensions/memory-hermes/` (new directory). The rebrand surface is deliberately limited to the four files in Section 5. Expected conflict surface is therefore near-zero except `src/config/paths.ts` and `package.json`, which change rarely upstream.
- **Cadence:** `git fetch upstream && git merge upstream/main` on a regular schedule. Establish it before it becomes a six-months-later problem.
- **Risk:** `src/config/paths.ts` is the one shared file with meaningful churn risk. Keep the `~/.paddy` change as small as possible (change the default constant + add an env prefix mapping, nothing else).

---

## 9. Open decisions for the user

1. **Grok-team coordination** — where is their work? Nothing is in this repo (blocker B2). Two parallel implementations will diverge.
2. **Add the `upstream` remote** — required by Section 1/5a; needs a go-ahead as a repo mutation.
3. **Rebrand scope confirmation** — accept the recommendation to rebrand only the user-facing boundary (bin name, `~/.paddy`, product strings) and keep the internal `openclaw` package identity for merge safety? This is a deliberate reading of Section 2's "minimal, maintainable changes," and it contradicts the directive's "small greppable set" premise, which is factually wrong at this scale.
4. **Root `memory` command ownership** — accept that `paddy memory …` exists only while `memory-hermes` holds the slot (Gotcha G1), or claim a dedicated command name?
5. **Dependency license audit** — run `pnpm install && pnpm licenses list` before any release (needs an installed tree).

**Per the directive, implementation does not start until this report is reviewed.**
