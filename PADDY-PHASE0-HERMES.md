# Paddy × Hermes — Phase 0 consolidated discovery report

Read-only investigation. No source modified. Baseline: `feat/paddy-branding` @ `b862693772b`
(= current `upstream/main` `124ddc0a49f` + the branding commit).

Method: six independent tracks (memory-core, Hermes-vs-core, security, lifecycle, config,
tests), then reconciled here. Every claim below is verified against current source with a
file citation. Where the tracks disagreed, the disagreement is recorded rather than smoothed.

---

## 0. Bottom line

**Paddy should not build a memory system.** OpenClaw's `memory-core` already owns, and does
better, almost everything the directive attributes to Hermes. The genuine build list is
**five capabilities**, all additive to `memory-core`, none of them a second store.

**The prior Grok design should be discarded, not ported.** `extensions/memory-hermes` on
`origin/backend/memory-hermes` creates a *second durable memory owner* — a competing SQLite
store, the same tool names, the same prompt hook — which is the one thing the repo's own
architecture rules (AGENTS.md: "one owner per responsibility") forbid.

---

## 1. What OpenClaw already owns — do not rebuild

| Capability | Owner | Evidence |
| --- | --- | --- |
| Durable MARKDOWN memory | `memory-core` | `MEMORY.md`/`USER.md`/`memory/**.md`; `src/memory/root-memory-files.ts`; `extensions/memory-core/src/memory/watch-policy.ts:67` |
| Semantic index + hybrid recall | `memory-core` | per-agent SQLite at `resolveOpenClawAgentSqlitePath` (`src/state/openclaw-agent-db.paths.ts:48`); hybrid vector+text 0.7/0.3, MMR λ0.7, temporal decay 30d, `maxResults` 6 / `minScore` 0.35 (`src/agents/memory-search.ts:62-85`) |
| Recall injection into the prompt | 3 paths | bootstrap files (`src/agents/bootstrap-files.ts:351`); `promptBuilder` (`src/agents/system-prompt.ts:735`); `before_prompt_build` via bundled `active-memory` (`extensions/active-memory/index.ts:188`) |
| Dreaming (light/REM/deep) | `memory-core` | `extensions/memory-core/src/dreaming-phases.ts:1458`; **enabled by default** (`src/memory-host-sdk/dreaming.ts:22`), managed cron `0 3 * * *` |
| Promotion into `MEMORY.md` | `memory-core` | `applyShortTermPromotions` (`short-term-promotion-apply.ts:184`), budget-guarded, marker-keyed |
| Caps + budgets | `memory-core` | `DEFAULT_MEMORY_FILE_MAX_CHARS = 10_000` (`memory-budget.ts:15`); bootstrap 20k/total 60k, USER.md fixed 4k |
| Provenance + origin gating | core | `src/memory/memory-artifact-provenance.ts`; `MemoryOriginClass` owner\|agent\|untrusted\|system |
| Forget / prune | `memory-core` | `paddy memory forget` (`memory-forget.ts:172`), tombstones, origin pruning |
| Fail-open hooks | core | all memory hooks are try/catch and never abort a turn (`extensions/memory-core/index.ts:283-325`) |
| A deterministic redaction engine | core | `src/logging/redact.ts` (~1,600 lines), `redact-patterns.ts` (vendor-token tables), `secret-redaction-registry.ts` (exact resolved values) |

**Verified first-hand** (not relayed): `authorizeSearchHits` exists and is fail-closed for
session hits (`src/plugins/memory-runtime.ts:217`); the default memory slot owner is
`"memory-core"` (`src/plugins/slots.ts:23`); dreaming defaults enabled.

Ranked recall in core is **strictly better** than either prior Hermes implementation — the
Grok plugin's token-overlap top-6 (`src/recall.ts:11-29`) is a regression, not a feature.

---

## 2. What is genuinely missing — the build list

All five are **requires code**, none is configuration-only.

| # | Capability | Why it's missing | Closest existing precedent to follow |
| --- | --- | --- | --- |
| **B1** | **Human-gated per-entry proposal → approve/reject** | No per-entry status field anywhere in memory. `memory-core`'s only staging is `memory promote` (prints candidates; `--apply` writes). The automatic dreaming path has **no gate** | `src/skills/workshop/store-sqlite-schema.ts:42` — a `pending\|applied\|rejected\|quarantined\|stale` state machine with worker-owned SQLite, revision hashing, events, and `store-rollback.ts` |
| **B2** | **Per-entry version history + single-entry rollback** | Only 8 whole-file preimages exist (`dreaming-consolidation-artifacts.ts:12`); no per-entry table, no rollback command | Same workshop pattern; per-entry identity already exists as the `<!-- openclaw-memory-promotion:<key> -->` marker (`short-term-promotion-memory-write.ts:17-26`) |
| **B3** | **Deterministic secret filter on memory writes** | Verified absent. Redaction exists but is never applied to stored memory content — only to logs/diagnostics | `src/logging/redact.ts` — reuse `computeSensitiveRedactionBitmap` (positions, not just replacement) |
| **B4** | **Per-identity memory scoping** | `memory-core` is agent/workspace-wide; one agent's `MEMORY.md` is shared across all senders. Isolation today is per-agent + session-visibility guards only | `src/plugins/registry-contribution-types.ts:240` `authorizeSearchHits` (fail-closed recall gate, already in the contract) |
| **B5** | **Post-turn candidate capture** | No post-turn memory hook exists. `agent_end` is the seam but needs plugin code | `memory-lancedb` does exactly this (`extensions/memory-lancedb/index.ts:527`) |

**Explicitly NOT required** (the tracks converged):

- Ranked recall, recall injection, session freeze, cross-conversation recall → **already exists**
- Dreaming toggles/thresholds/cadence → **configuration-only**
- A configurable/per-phase model override **including local models** → **configuration-only** today: `dreaming.model`, `dreaming.phases.<p>.execution.model`, gated by `plugins.entries.memory-core.subagent.allowModelOverride`. Provider-agnostic; any OpenAI-compatible `baseUrl` works.
- **Fail-open** → already the behaviour of every memory hook
- **Tight caps:** a *single global* cap is configuration-only (`agents.defaults.bootstrapMaxChars`). The Hermes **2,200/1,375 split is NOT** — there is one scalar plus a fixed 4,000 USER ceiling that can only be lowered, and over-cap content is **truncated**, which is the opposite of Hermes' reject-on-overflow. This is B-list adjacent (see D2).

---

## 3. What to discard from the prior work

The Grok `extensions/memory-hermes` plugin duplicates owners, per Track 2:

| Duplication | Conflict |
| --- | --- |
| `~/.paddy/hermes/memory.sqlite` (`src/paths.ts:13`) | A second durable store for what `memory-core` already stores |
| Registers `memory_search` / `memory_get` (`index.ts:60,100`) | The **same tool names** `memory-core` declares — two owners of one tool identity |
| `before_prompt_build` recall (`index.ts:145`) | `active-memory` already owns that path |
| Takes `plugins.slots.memory` (branch `src/plugins/slots.ts:24`) | Disables `memory-core`, losing dreaming/index/MARKDOWN |

The bundle's own test suite is real (scope isolation, secret-block, single-entry rollback,
fail-open) and is worth keeping **as a specification** for B1/B2/B3 — but the implementation
should not land.

Two genuine defects in it if any of it is reused: a `DatabaseSync` open/close **per tool call
and per hook** (`index.ts:34-45`), and a dead `curatorModel` config key no code reads.

---

## 4. The central architectural decision

**Do not take `plugins.slots.memory`.** Taking the slot disables `memory-core` and therefore
destroys the storage, index, dreaming and MARKDOWN owners Paddy depends on. Build **B1–B5 as
an additive companion** — no `kind`, using `registerMemoryPromptSupplement` /
`registerMemoryPromptPreparation` plus hooks.

**Consequence for the approval gate:** if unapproved memories never reach `MEMORY.md`, recall
needs no gate at all — `memory-core` only ever sees approved content. The gate lives on the
**write** side. This is simpler than gating recall and avoids competing with `memory-core`.

**Consequence for B4 (identity scoping):** this is the one requirement that does not fit
`memory-core`'s model — `MEMORY.md` is deliberately workspace-wide. Options: (a) scope the
*proposal store* per identity and promote into identity-tagged sections, or (b) add an
`authorizeSearchHits`-style gate. **This needs a design decision, not an agent's assumption.**

---

## 5. Integration points (verified)

**Write choke point (B3):** `MemoryWriteProvenanceObserver.write` —
`src/agents/memory-write-provenance.ts:118-147`, committing at `:135`. Already funnels
`write`/`edit`/`apply_patch`, the compaction flush, and the session hook for exactly the
paths `normalizeMemoryArtifactRelativePath` classifies (`src/memory/memory-artifact-provenance.ts:43`).
Throwing there aborts before disk. **Three paths sit outside it** and need their own hook:
dreaming's `commitMemoryContent` (`short-term-promotion-memory-write.ts:139`), lancedb's
`db.store` (`lancedb-store.ts:170`), and gateway `users.personalFile.set`
(`users-personal-file.ts:248`) — the last is a genuine coverage gap.

**Design constraint:** a filter in `src/` can import `computeSensitiveRedactionBitmap` and get
*positions* (reject vs scrub). The plugin SDK exposes only `redactSensitiveText` (string→string),
so an extension-side filter degrades to `redacted !== original`. **Put the filter in core**,
consumed by the plugin. Always pass explicit options so `logging.redactPatterns` / `mode: "off"`
cannot weaken it.

**Capture point (B5):** plugin `agent_end` (`src/plugins/hook-types.ts:403`). Caveats: it does
**not** fire for detached runs (memory flush, skill review) or `handled` claim turns; and
non-bundled plugins need `hooks.allowConversationAccess: true`. Budget 30s; fire-and-forget on
the channel path — do not make it awaited.

**Storage for B1/B2:** plugin-owned `openSqliteWorkerStore` (`openclaw/plugin-sdk/sqlite-runtime`)
or `api.runtime.state.openKeyedStore`. **Never `node:sqlite` on the Gateway main thread** —
`AGENTS.md:70-73`. Note `extensions/memory-core/src/memory-entry-origins.ts:157-197` does this
today; it is legacy and must not be imitated.

**CLI/RPC:** `api.registerCli` + `api.registerGatewayMethod` with `operator.*` scopes; mutations
the running Gateway owns go through RPC, not cross-process SQLite.

**Do not touch:** `src/agents/**`, `src/auto-reply/**`, the prepared-memory-section lifecycle
(`src/plugins/memory-state.ts`), the pre-turn flush/compaction ordering, the `agent_end`
fire-and-forget semantics, or the dreaming write owner.

---

## 6. Smallest coherent implementation plan

Ordered so each step is independently verifiable and none depends on an unproven assumption.

1. **B3 — secret filter (core).** Add a deterministic filter module near
   `src/memory/memory-artifact-provenance.ts`, built on `computeSensitiveRedactionBitmap` with
   explicit options. Wire it at the write observer (`:135`) plus the three bypass paths.
   *Smallest, highest-value, no new store, no new owner.*
2. **B5 + B1 — proposal capture and approval state machine.** New additive plugin
   (`extensions/memory-hermes/`, no `kind`): `agent_end` handler writes candidates to a
   plugin-owned worker store; CLI `paddy memory list|approve|reject|rollback` + scoped gateway
   methods. Model the schema on the skills workshop.
3. **B2 — per-entry versioning.** Extend the proposal store with per-entry revisions keyed by
   the promotion marker; rollback reverses one promotion.
4. **B4 — identity scoping.** *Blocked on the decision in §4.* Do not start until chosen.
5. **Caps (D2).** Only if the 2,200/1,375 split is still wanted after §4 — it needs a per-file
   budget map or a cap-aware writer, not configuration.

**Deliberately excluded:** dreaming, indexing, recall, injection, MARKDOWN ownership, tool
names — all remain `memory-core`'s.

---

## 7. Test plan (per Track 6, following repo conventions)

Cheapest valid layer per requirement; extend existing suites rather than creating new ones.

| Requirement | Layer | Where |
| --- | --- | --- |
| B3 secret filter rejects, curator-independent | pure unit | new `packages/memory-host-sdk/src/host/*.test.ts`; product proof extends `extensions/memory-core/src/redaction-product-boundaries.test.ts` |
| B3 bypass paths covered | unit | `src/agents/memory-write-provenance.test.ts` + one regression per bypass (dreaming/lancedb/gateway) |
| B1 nothing durable without approval | direct store | extend `short-term-promotion.test.ts` |
| B2 one-entry rollback leaves others intact | direct store | extend `short-term-promotion.test.ts` / `-memory-write.test.ts` |
| B4 no cross-identity recall | in-process | extend `session-search-visibility.cross-agent.test.ts` |
| B5 fail-open: curator failure never blocks a turn | turn-level | `src/auto-reply/reply/agent-runner-memory.test.ts` |
| caps enforced; fresh install needs no service | pure + harness | `memory-budget.test.ts`; `doctor-memory-startup.test.ts` |

Conventions: `createMemoryCoreTestHarness()`, no bare `fs.mkdtemp`, no real timers/sleeps, no
new serial config or worker pin, `<5s` per file. Memory-core tests route through the
**`extension-database-workers`** lane, not `extension-memory`. E2E belongs in the release tier.
`test-audit` is the authoring gate.

---

## 8. Open questions requiring a decision (not an agent guess)

1. **B4 identity scoping** — the only requirement that does not fit `MEMORY.md`'s workspace-wide
   model. Implementation is blocked on this.
2. **Tight caps** — is the 2,200/1,375 split still wanted given it requires code, given that
   OpenClaw truncates rather than rejects?
3. **The prior Grok work** — confirm it is discarded (specification only) rather than ported.
4. **Direct agent writes to `MEMORY.md`** — the agent can still write it with file tools,
   bypassing the proposal queue. Does the gate need to cover that path, and does that conflict
   with `memory-core`'s "one primary writer" doctrine?
