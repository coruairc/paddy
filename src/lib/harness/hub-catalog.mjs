// @ts-nocheck
/** Bundled playbooks. Local catalog — not a live ClawHub pull. */

export const HUB_SKILLS = [
  {
    slug: "paddy/meeting-actions",
    name: "meeting-actions",
    description: "Turn messy meeting notes into owners, dates, tickets, and a sendable recap.",
    instructions: `Ask for raw notes if they are missing — do not invent attendees or dates.

DO:
1. Parse Action items (owner, due), Decisions, Open questions.
2. canvas_render kind=markdown title="Meeting recap" with those three sections.
3. create_ticket for each action item (title = owner + verb, body = due + context, status=backlog).
4. Offer schedule_wake for the next check-in if a date is stated.

DON'T: invent owners, claim you emailed anyone, or dump the recap only in chat when the canvas exists.`,
    triggers: ["meeting notes", "action items", "recap this"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "writing",
    version: "1.3.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/google-calendar",
    name: "google-calendar",
    description: "Daily briefing from calendar-shaped facts the operator pastes or remembers.",
    instructions: `This kit does not log into Google. Work from what the operator pastes, from MEMORY.md, or say you need the schedule.

DO:
1. search_memory for timezone and standing blocks.
2. Compress the next 5 blocks: when, what, who.
3. canvas_render kind=stats title="Day ahead" with free hours + next meeting.
4. Offer write_daily with a one-line plan.

DON'T: invent events or claim a live calendar sync.`,
    triggers: ["what's on my calendar", "daily brief", "am I free"],
    author: "niceperson",
    registry: "clawhub",
    trust: "community",
    category: "calendar",
    version: "2.1.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/gmail-triage",
    name: "gmail-triage",
    description: "Triage a pasted inbox dump: now / later / archive, with draft replies.",
    instructions: `Never send mail. This kit has no Gmail API.

DO:
1. Ask for a paste if none. Classify each thread: now / later / archive.
2. Draft at most three replies. If channel-voice is installed, match that register.
3. canvas_render kind=markdown title="Inbox triage" as a table (from, subject, bucket, draft?).
4. create_ticket only for threads that need a real follow-up.

DON'T: claim you archived or sent anything.`,
    triggers: ["triage my inbox", "draft a reply", "email dump"],
    author: "niceperson",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "1.9.0",
    installs: "bundled",
  },
  {
    slug: "hermes/web-brief",
    name: "web-brief",
    description: "Compress a topic into claims, unknowns, and next lookups.",
    instructions: `Three sections only: Claims, Unknowns, Next.

DO:
1. Use only what the operator supplied plus MEMORY.md. Do not invent sources.
2. canvas_render kind=markdown title="Brief: {topic}".
3. If there are counts, canvas_render kind=stats as a second card.
4. write_memory kind=lesson only if a durable takeaway appeared.

DON'T: fake citations or browse the live web — this kit has no browser.`,
    triggers: ["brief me on", "what do we know", "research"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "research",
    version: "1.0.0",
    installs: "bundled",
  },
  {
    slug: "openai/pr-review",
    name: "pr-review",
    description: "Review a diff: risk, tests, and a merge recommendation.",
    instructions: `Need a diff or a precise description. Be specific to the code.

DO:
1. Output Risk, Missing tests, Nits, Verdict (merge / request changes).
2. canvas_render kind=markdown title="PR review".
3. create_ticket for each blocking finding (status=backlog).

DON'T: rubber-stamp. If there is no diff, ask for one.`,
    triggers: ["review this pr", "look at this diff"],
    author: "catalog",
    registry: "openai",
    trust: "trusted",
    category: "coding",
    version: "1.5.0",
    installs: "bundled",
  },
  {
    slug: "anthropic/sql-guard",
    name: "sql-guard",
    description: "Rewrite a query to be read-only and comment the dangerous bits.",
    instructions: `Refuse DROP/TRUNCATE/DELETE without WHERE. Prefer SELECT. Never invent schema.

DO:
1. Point at the scan (seq vs index) if you can tell.
2. Emit a safer rewrite.
3. canvas_render kind=markdown title="SQL guard" with original, rewrite, and why.

DON'T: run the query. This kit has no database shell.`,
    triggers: ["check this sql", "is this query safe"],
    author: "catalog",
    registry: "anthropic",
    trust: "trusted",
    category: "coding",
    version: "1.2.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/incident-page",
    name: "incident-page",
    description: "Run an incident: severity, timeline, comms, next action.",
    instructions: `Ask severity if missing (sev1–sev4). Keep a running timeline.

DO:
1. checkpoint label="pre-incident" before mutating memory.
2. canvas_render kind=timeline title="Incident" with what you know, in order.
3. create_ticket title="Incident: {symptom}" status=doing, body=severity + next action.
4. Draft a status blurb (what, impact, next update time). Offer write_daily.

DON'T: pretend you paged anyone. send_channel stays queued.`,
    triggers: ["incident", "we're down", "sev"],
    author: "pager",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "3.1.0",
    installs: "bundled",
  },
  {
    slug: "hermes/pdf-digest",
    name: "pdf-digest",
    description: "Digest pasted document text into a one-page brief.",
    instructions: `Thesis, 5 bullets, quotes worth keeping, open questions. No filler.

DO:
1. Ask for the paste if missing.
2. canvas_render kind=markdown title="One-pager".
3. write_memory kind=fact only for durable facts the operator will want later.

DON'T: invent quotes or claim you opened a PDF binary.`,
    triggers: ["digest this", "summarize this pdf", "one-pager"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "research",
    version: "1.1.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/customer-reply",
    name: "customer-reply",
    description: "Draft a support reply that matches the user's register and facts.",
    instructions: `Search memory for product facts. Don't invent refund policy.

DO:
1. search_memory for the product / policy.
2. Offer two tones: terse and warm. Put both on the canvas.
3. canvas_render kind=markdown title="Support drafts".
4. create_ticket if this needs a human follow-up.

DON'T: send mail. Match USER.md voice if it exists.`,
    triggers: ["reply to this customer", "support ticket"],
    author: "ember",
    registry: "clawhub",
    trust: "community",
    category: "writing",
    version: "1.4.0",
    installs: "bundled",
  },
  {
    slug: "paddy/weekly-okrs",
    name: "weekly-okrs",
    description: "Roll a week into shipped / learned / stuck / next against stated goals.",
    instructions: `Four sections only. Keep it under a page.

DO:
1. search_memory and skim recent tickets.
2. canvas_render kind=markdown title="Week in review" — Shipped / Learned / Stuck / Next.
3. write_daily with a two-line rollup.
4. If this format lands, patch_skill weekly-okrs with any tweak the operator asked for.

DON'T: invent shipped work.`,
    triggers: ["weekly review", "okrs", "week in review"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "ops",
    version: "1.1.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/browser-research",
    name: "browser-research",
    description: "Plan a browsing trail: queries, pages to open, what to extract.",
    instructions: `This preview has no live browser. Produce a numbered trail the operator can run.

DO:
1. Queries, URLs or site classes, what to extract from each.
2. canvas_render kind=markdown title="Research trail".
3. write_memory only when the operator pastes findings back.

DON'T: claim you opened pages.`,
    triggers: ["browse for", "research online", "open these sites"],
    author: "canvas",
    registry: "clawhub",
    trust: "community",
    category: "research",
    version: "0.8.0",
    installs: "bundled",
  },
  {
    slug: "hermes/apple-notes",
    name: "apple-notes",
    description: "Shape a note the operator can paste into Apple Notes: title, tags, body.",
    instructions: `Title ≤ 60 chars. Body in short paragraphs. Tags kebab-case.

DO:
1. Emit the note as a fenced block they can copy.
2. canvas_render kind=markdown title="{title}".
3. Offer write_memory kind=fact if it should live in MEMORY.md too.

DON'T: claim you wrote to the device.`,
    triggers: ["save a note", "apple notes"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "memory",
    version: "0.5.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/whisper-notes",
    name: "whisper-notes",
    description: "Clean a voice-memo transcript: speakers, actions, a 5-line summary.",
    instructions: `If the paste is messy ASR, punctuate lightly. Don't invent speakers.

DO:
1. Clean the transcript. Extract actions last.
2. canvas_render kind=markdown title="Voice memo".
3. create_ticket for each action with an owner if named.

DON'T: invent a speaker diarization the paste does not support.`,
    triggers: ["transcript", "voice memo", "whisper"],
    author: "niceperson",
    registry: "clawhub",
    trust: "community",
    category: "voice",
    version: "1.6.0",
    installs: "bundled",
  },
  {
    slug: "openai/k8s-ops",
    name: "k8s-ops",
    description: "Read-only Kubernetes first aid: diagnose from pasted describe/logs.",
    instructions: `Never suggest unguarded apply/delete. Prefer kubectl get/describe.

DO:
1. Call out crashloop vs probe vs quota vs image pull.
2. Give the next read-only command.
3. canvas_render kind=markdown title="k8s first aid".
4. create_ticket if this is an ongoing incident.

DON'T: invent cluster state or kubectl apply.`,
    triggers: ["pod is crashlooping", "k8s", "kubernetes"],
    author: "catalog",
    registry: "openai",
    trust: "trusted",
    category: "coding",
    version: "2.2.0",
    installs: "bundled",
  },
  {
    slug: "hermes/openclaw-migrate",
    name: "openclaw-migrate",
    description: "Map an OpenClaw workspace (SOUL, skills, channels) onto Paddy files.",
    instructions: `Ask what they have. Map SOUL.md→soul, MEMORY.md→memory, skills→import SKILL.md or create_skill.

DO:
1. List the mapping. Don't invent API keys.
2. For each pasted SKILL.md, tell them to Import SKILL.md on Skills, or call create_skill yourself if they pasted the body.
3. Channels stay idle in this kit — say so.
4. canvas_render kind=diagram title="OpenClaw → Paddy" if helpful.

DON'T: claim Telegram/WhatsApp came over.`,
    triggers: ["migrate from openclaw", "import claw", "coming from openclaw"],
    author: "catalog",
    registry: "hermes",
    trust: "community",
    category: "ops",
    version: "0.4.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/travel-pack",
    name: "travel-pack",
    description: "Packing list + timeline from a destination and dates.",
    instructions: `Need place and dates. Climate-sensible list, documents, a day-of timeline.

DO:
1. Ask for place + dates if missing.
2. canvas_render kind=timeline title="Trip · {place}".
3. canvas_render kind=markdown title="Packing" as a checklist.
4. Offer schedule_wake the night before.

DON'T: invent visa rules.`,
    triggers: ["packing list", "trip to", "travel"],
    author: "ada",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "1.1.0",
    installs: "bundled",
  },
  {
    slug: "clawhub/expense-capture",
    name: "expense-capture",
    description: "Normalize pasted receipts into a table: date, vendor, amount, category.",
    instructions: `Don't guess currency if missing. Flag duplicates.

DO:
1. Parse each receipt line.
2. canvas_render kind=markdown title="Expenses" as a markdown table + a totals row.
3. If counts help, also canvas_render kind=stats.

DON'T: invent amounts.`,
    triggers: ["expense", "receipt", "i spent"],
    author: "ledger",
    registry: "clawhub",
    trust: "community",
    category: "ops",
    version: "1.3.0",
    installs: "bundled",
  },
  {
    slug: "paddy/x-thread",
    name: "x-thread",
    description: "Break a take into a numbered X thread with a hook and a closer.",
    instructions: `Hook, 5–8 beats, closer. No hashtag soup. Match USER.md voice.

DO:
1. Numbered posts, each ≤ 280 chars.
2. canvas_render kind=markdown title="Thread".
3. Offer write_memory kind=preference if they correct the voice.

DON'T: post. This kit does not tweet.`,
    triggers: ["thread this", "tweet thread", "post this on x"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "writing",
    version: "1.1.0",
    installs: "bundled",
  },
  {
    slug: "paddy/daily-journal",
    name: "daily-journal",
    description: "One honest paragraph into today’s daily note, plus a durable fact if any.",
    instructions: `Short. No secrets. Today only.

DO:
1. write_daily with 1–3 sentences the operator actually said or confirmed.
2. If a durable fact/preference appeared, write_memory with the right kind.
3. Confirm what you persisted in one line.

DON'T: diary-pad empty days.`,
    triggers: ["journal", "daily note", "log today"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "memory",
    version: "1.0.0",
    installs: "bundled",
  },
  {
    slug: "paddy/decision-log",
    name: "decision-log",
    description: "Record a decision: context, choice, because, revisit date.",
    instructions: `Need a real choice. Ask if the because is missing.

DO:
1. write_memory kind=lesson with the decision in one or two sentences.
2. canvas_render kind=markdown title="Decision" — Context / Choice / Because / Revisit.
3. create_ticket if work follows from it.
4. Offer schedule_wake on the revisit date.

DON'T: invent the because.`,
    triggers: ["we decided", "decision log", "adr"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "memory",
    version: "1.0.0",
    installs: "bundled",
  },
  {
    slug: "paddy/ticket-cut",
    name: "ticket-cut",
    description: "Turn a blob of work into kanban tickets with a first doing item.",
    instructions: `Cut scope. One ticket = one next action.

DO:
1. Split the ask into 2–6 tickets. First one status=doing, rest backlog.
2. create_ticket for each (title verb-first, body = acceptance in one line).
3. canvas_render kind=stats title="Cut" with counts per column.

DON'T: create a ticket that is the whole project.`,
    triggers: ["cut tickets", "make tickets", "break this down"],
    author: "paddy",
    registry: "paddy",
    trust: "official",
    category: "ops",
    version: "1.0.0",
    installs: "bundled",
  },
];
